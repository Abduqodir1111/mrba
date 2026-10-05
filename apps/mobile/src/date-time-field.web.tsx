import React from "react";
export function DateTimeField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <input type="datetime-local" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} style={{boxSizing:'border-box',width:'100%',minWidth:0,border:'1px solid #E5E9EC',borderRadius:12,padding:12,fontSize:14,color:'#182C3C',background:'#fff',fontFamily:'inherit'}} />;
}
