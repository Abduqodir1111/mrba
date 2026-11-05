import test from 'node:test';
import assert from 'node:assert/strict';
import {completionProducts} from '../apps/mobile/src/completion-products.ts';
test('multiple product weights convert independently and retain selected types',()=>{
 const rows=[{itemId:'a',quantity:'2,5'},{itemId:'b',quantity:'0.125'},{itemId:'',quantity:''}];
 assert.deepEqual(completionProducts(rows,'t',['a','b']),[{itemId:'a',quantityKg:'2500'},{itemId:'b',quantityKg:'125'}]);
 assert.deepEqual(completionProducts(rows,'kg',['a','b']),[{itemId:'a',quantityKg:'2.5'},{itemId:'b',quantityKg:'0.125'}]);
});
test('invalid precision, missing types, negative quantities and duplicate products cannot be submitted',()=>{
 for(const rows of [[{itemId:'a',quantity:'0.0001'}],[{itemId:'',quantity:'1'}],[{itemId:'a',quantity:'-1'}],[{itemId:'a',quantity:'Infinity'}],[{itemId:'a',quantity:'1'},{itemId:'a',quantity:'2'}]])assert.throws(()=>completionProducts(rows,'kg',['a']));
 assert.deepEqual(completionProducts([{itemId:'',quantity:'0'}],'kg',[]),[]);
});
