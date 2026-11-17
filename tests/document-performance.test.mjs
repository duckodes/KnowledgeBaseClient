import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentApi, validateFiles, DOCUMENT_ENDPOINT } from '../reader/document-api.js';
const user={getIdToken:async()=>'synthetic'};
const files=Array.from({length:98},(_,i)=>({path:`${i}/README.md`,bytes:8192,updated:'2026-11-10T00:00:00Z',content:'# Synthetic\n\n'+'x'.repeat(8179)}));
const encoder=new TextEncoder();
function network(body){
	const bytes=encoder.encode(JSON.stringify(body));let offset=0;
	return new Response(new ReadableStream({async pull(controller){await new Promise(resolve=>setTimeout(resolve,2));const chunk=bytes.subarray(offset,offset+8192);offset+=chunk.length;if(chunk.length)controller.enqueue(chunk);else controller.close();}}),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
}
test('controlled synthetic payload comparison: bulk strategy vs selected-document transport',async()=>{
	const beforeStart=performance.now();
	const bulk=network({files});
	const bulkBytes=encoder.encode(JSON.stringify({files})).length;
	validateFiles(await bulk.json(),true);
	const beforeMs=performance.now()-beforeStart;
	const api=createDocumentApi({fetchImpl:async(url)=>{
		await new Promise(resolve=>setTimeout(resolve,10));
		return network(url.startsWith(DOCUMENT_ENDPOINT+'?')?{files:files.map(({content,...metadata})=>metadata)}:{file:files[0]});
	}});
	const metadata=await api.listDocuments(user);
	const single=await api.loadDocument(user,files[0].path);
	assert.ok(single.metrics.bytes<bulkBytes/90);
	assert.equal(single.metrics.retries,0);
	console.log(JSON.stringify({evidence:'controlled mock only; user-confirmed file envelope',model:{documents:98,chunkBytes:8192,chunkDelayMs:2,headerDelayMs:10},before:{bulkBytes,requestMs:Math.round(beforeMs)},after:{metadataMs:Math.round(metadata.metrics.requestMs),metadataBytes:metadata.metrics.bytes,singleMs:Math.round(single.metrics.requestMs),singleBytes:single.metrics.bytes,bodyMs:Math.round(single.metrics.bodyMs),retryCount:single.metrics.retries}}));
});
