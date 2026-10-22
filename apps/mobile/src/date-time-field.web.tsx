import React from "react";
export function DateTimeField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <input type="datetime-local" aria-label={label} value={value} onChange={e=>onChange(e.target.value)} style={{boxSizing:'border-box',width:'100%',minWidth:0,border:'1px solid rgba(105,134,175,0.16)',borderRadius:16,padding:13,minHeight:48,fontSize:16,color:'#15283F',background:'rgba(255,255,255,0.88)',fontFamily:'inherit'}} />;
}
