import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentApi, validateFiles, validateSingleDocument, LIMITS, SINGLE_DOCUMENT_ENDPOINT } from "../reader/document-api.js";
const file = { path: "06_架構/README + 😀.md", bytes: 42, updated: "2026-11-10T06:02:12.353Z", content: "# Synthetic" };
const user = { getIdToken: async () => "synthetic-token" };
const json = (payload, headers = {}, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store", ...headers } });
const code = (expected) => (error) => error.code === expected && error.message === expected;
const apiWith = (options) => createDocumentApi({ maxRetries: 0, ...options });
test("single-file envelope validates the user-confirmed fields and exact requested identity", () => {
	assert.deepEqual(validateSingleDocument({ file: { ...file, ignored: "extra" } }, file.path), file);
	for (const payload of [null, {}, file, { files: [file] }, { file: [] }, { file: null }, { file: { ...file, path: "other/README.md" } }, { file: { ...file, content: undefined } }, { file: { ...file, content: 42 } }]) {
		assert.throws(() => validateSingleDocument(payload, file.path), code("schema"));
	}
});
test("metadata schema mapping, duplicate paths and invalid types stay strict", () => {
	assert.deepEqual(validateFiles({ files: [file] }), [{ path: file.path, bytes: file.bytes, updated: file.updated }]);
	assert.deepEqual(validateFiles({ files: [] }), []);
	assert.equal(validateFiles({files:Array.from({length:98},(_,i)=>({...file,path:`${i}.md`}))}).length,98);
	for(const payload of [null, {}, {files:{}}, {files:[null]}, {files:[file,file]}]) assert.throws(()=>validateFiles(payload),code('schema'));
	for(const field of [{path:''},{bytes:-1},{bytes:1.1},{bytes:'42'},{updated:'not-date'},{updated:1},{content:null}]) assert.throws(()=>validateFiles({files:[{...file,...field}]},true),code('schema'));
});
test("traversal, malformed encoding and Unicode paths remain rejected",()=>{
	for(const path of ['../x.md','a/../x.md','/x.md','a//x.md','a/./x.md','a\\x.md','%2e%2e/x.md','x%ZZ.md','x\ud800.md','x\u0000.md','https://x.md','x.md#x']) assert.throws(()=>validateFiles({files:[{...file,path}]}),code('schema'));
	assert.equal(validateFiles({files:[file]})[0].path,file.path);
});
test("document count, content and declared aggregate size are bounded",()=>{
	assert.throws(()=>validateFiles({files:Array(LIMITS.files+1).fill(file)}),code('limit'));
	assert.throws(()=>validateFiles({files:[{...file,bytes:LIMITS.fileBytes+1}]}),code('limit'));
	assert.throws(()=>validateFiles({files:[{...file,content:'x'.repeat(LIMITS.contentChars+1)}]},true),code('limit'));
	assert.throws(()=>validateFiles({files:Array.from({length:60},(_,i)=>({...file,bytes:LIMITS.fileBytes,path:`${i}.md`}))}),code('limit'));
});
test("GET encodes exact metadata path and never calls a bulk content endpoint",async()=>{
	const calls=[];
	const api=apiWith({fetchImpl:async(url,options)=>{calls.push({url,options});return json(url.includes('includeContent=false')?{files:[file]}:{file:file});}});
	await api.listDocuments(user);
	assert.equal((await api.loadDocument(user,file.path)).document.content,file.content);
	assert.equal(new URL(calls[0].url).searchParams.get('includeContent'),'false');
	assert.equal(new URL(calls[1].url).origin+new URL(calls[1].url).pathname,SINGLE_DOCUMENT_ENDPOINT);
	assert.equal(new URL(calls[1].url).searchParams.get('path'),file.path);
	for(const {url,options} of calls){assert.ok(!url.includes('synthetic-token')); assert.equal(options.headers.Authorization,'Bearer synthetic-token');assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');}
	await assert.rejects(api.loadDocument(user,'../x.md'),code('schema')); assert.equal(calls.length,2);
	assert.equal('loadAllDocumentContents' in api,false);
});
test("Content-Type, UTF-8, missing content and streamed size limits are enforced",async()=>{
	for(const response of [new Response('{',{headers:{'content-type':'application/json'}}),json({file:{...file,content:null}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})]) await assert.rejects(apiWith({fetchImpl:async()=>response}).loadDocument(user,file.path),code('schema'));
	for(const response of [json({}, {'content-length':String(LIMITS.singlePayloadBytes+1)}), new Response(new Uint8Array(LIMITS.singlePayloadBytes+1),{headers:{'content-type':'application/json'}})]) await assert.rejects(apiWith({fetchImpl:async()=>response}).loadDocument(user,file.path),code('limit'));
});
test("HTTP/auth/schema/limit failures do not retry or leak response details",async()=>{
	for(const [status,expected] of [[400,'http'],[401,'unauthorized'],[403,'forbidden'],[404,'not-found'],[500,'server'],[501,'server']]){
		let calls=0;
		const api=apiWith({maxRetries:2,fetchImpl:async()=>{calls++;return new Response('sensitive body',{status});}});
		await assert.rejects(api.loadDocument(user,file.path),code(expected)); assert.equal(calls,1);
	}
	for(const payload of [{files:[]},{file:{...file,content:null}},{file:{...file,content:'x'.repeat(LIMITS.contentChars+1)}}]){
		let calls=0;await assert.rejects(apiWith({maxRetries:2,fetchImpl:async()=>{calls++;return json(payload);}}).loadDocument(user,file.path));assert.equal(calls,1);
	}
});
test("network, 429 and temporary gateways retry twice with cancellation and fresh tokens",async()=>{
	for(const status of [0,429,502,503,504]){
		let calls=0,tokens=0;const waits=[],states=[];
		const api=apiWith({maxRetries:2,random:()=>0,sleep:async(ms,signal)=>{assert.ok(!signal.aborted);waits.push(ms);},fetchImpl:async()=>{calls++;if(calls===3)return json({file:file});if(!status)throw new TypeError('network');return json({}, {'retry-after':'2'},status);}});
		const result=await api.loadDocument({getIdToken:async()=>{tokens++;return 'synthetic';}},file.path,undefined,{onState:state=>states.push(state)});
		assert.equal(calls,3);assert.equal(tokens,3);assert.equal(result.metrics.retries,2);assert.equal(states.length,2);assert.deepEqual(waits,status?[2000,2000]:[250,500]);
	}
});
test("retry exhaustion is bounded and a new manual call can recover",async()=>{
	let calls=0;let fail=true;
	const api=apiWith({maxRetries:99,sleep:async()=>{},fetchImpl:async()=>{calls++;return json(fail?{}:{file:file},{},fail?503:200);}});
	await assert.rejects(api.loadDocument(user,file.path),error=>error.code==='server'&&error.metrics.retries===2);assert.equal(calls,3);
	fail=false;assert.equal((await api.loadDocument(user,file.path)).document.path,file.path);assert.equal(calls,4);
});
test("token acquisition, headers and stalled body all have timeout/retry coverage",async()=>{
	const keepAlive=setTimeout(()=>{},2000);
	try{
		for(const phase of ['token','headers','body']){
			let calls=0;const selectedUser={getIdToken:()=>phase==='token'&&calls++===0?new Promise(()=>{}):Promise.resolve('synthetic')};
			const api=apiWith({timeoutMs:8,deadlineMs:200,maxRetries:1,sleep:async()=>{},fetchImpl:async()=>{if(phase==='headers'&&calls++===0)return new Promise(()=>{});if(phase==='body'&&calls++===0)return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});return json({file:file});}});
			const result=await api.loadDocument(selectedUser,file.path);assert.equal(result.metrics.retries,1);assert.equal(result.document.path,file.path);
		}
	}finally{clearTimeout(keepAlive);}
});
test("total deadline includes backoff and never violates a long Retry-After",async()=>{
	let calls=0;const keepAlive=setTimeout(()=>{},1000);
	try{await assert.rejects(apiWith({deadlineMs:12,maxRetries:2,fetchImpl:async()=>{calls++;return json({}, {'retry-after':'60'},429);}}).loadDocument(user,file.path),error=>error.code==='rate-limited'&&error.retryAt>Date.now());assert.equal(calls,1);}finally{clearTimeout(keepAlive);}
});
test("anonymous, aborted and failed SDK identity calls cannot send requests",async()=>{
	let calls=0;const controller=new AbortController();controller.abort('route-change');
	const api=apiWith({maxRetries:2,fetchImpl:async()=>{calls++;return json({file:file});}});
	await assert.rejects(api.listDocuments(null),code('login-required'));
	await assert.rejects(api.loadDocument(user,file.path,controller.signal),code('abort'));
	await assert.rejects(api.listDocuments({getIdToken:async()=>{throw {code:'auth/user-token-expired'};}}),code('unauthorized'));
	assert.equal(calls,0);
});
test("cache header policy and private-free timing statistics are explicit",async()=>{
	for(const [header,expected] of [[null,'unknown'],['public, max-age=3600','unsafe'],['private, no-store','no-store']]){
		const response=json({files:[]});if(header)response.headers.set('cache-control',header);else response.headers.delete('cache-control');
		const result=await apiWith({fetchImpl:async()=>response}).listDocuments(user);assert.equal(result.cachePolicy,expected);
		for(const key of ['tokenMs','headersMs','bodyMs','bytes','requestMs','retries'])assert.ok(result.metrics[key]>=0);
		assert.doesNotMatch(JSON.stringify(result.metrics),/synthetic-token|README|content|uid/);
	}
});
