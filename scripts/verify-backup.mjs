import {spawnSync} from 'node:child_process';
import {mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const container=process.env.MRBA_TEST_DB_CONTAINER??'mrba-dev-postgres-1';
const user=process.env.MRBA_TEST_DB_USER??'mrba';
const database='mrba_test';
const restored='mrba_restorecheck_'+randomUUID().replaceAll('-','');
const dir=mkdtempSync(join(tmpdir(),'mrba-restore-'));
function run(args,options={}){const r=spawnSync('docker',['exec','-i',container,...args],{encoding:'utf8',...options});if(r.status!==0)throw Error(`Backup verification command failed: ${r.stderr??''}`);return r.stdout;}
let created=false;
try{
 const out=openSync(join(dir,'test.dump'),'w',0o600);
 try{run(['pg_dump','-U',user,'-d',database,'--format=custom','--no-owner'],{stdio:['ignore',out,'pipe']});}finally{closeSync(out);}
 run(['createdb','-U',user,restored]);created=true;
 const input=openSync(join(dir,'test.dump'),'r');
 try{run(['pg_restore','-U',user,'-d',restored,'--no-owner','--exit-on-error'],{stdio:[input,'pipe','pipe']});}finally{closeSync(input);}
 const query='SELECT count(*) FROM (SELECT b."lotId" FROM "InventoryBalance" b LEFT JOIN "StockMovement" m ON b."lotId"=m."lotId" AND b."locationId"=m."locationId" GROUP BY b."lotId",b."locationId",b."onHandKg" HAVING b."onHandKg"<>COALESCE(SUM(m."signedQuantityKg"),0)) inconsistent';
 const mismatch=run(['psql','-U',user,'-d',restored,'-tAc',query]).trim();if(mismatch!=='0')throw Error('Restored stock ledger does not reconcile');
 for(const table of ['StockMovement','AuditLog','ProductionBatch','Shipment','CommandReceipt']){const sql=`SELECT count(*) FROM "${table}"`;const source=run(['psql','-U',user,'-d',database,'-tAc',sql]).trim();const target=run(['psql','-U',user,'-d',restored,'-tAc',sql]).trim();if(source!==target)throw Error(`Row count differs: ${table}`);}
 console.log('PASS: PostgreSQL custom archive restored into a new isolated database; stock ledger reconciles and all critical table counts match.');
}finally{if(created)run(['dropdb','-U',user,restored]);rmSync(dir,{recursive:true,force:true});}
