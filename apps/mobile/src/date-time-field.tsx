import React from "react";
import {TextInput} from "react-native";
export function DateTimeField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder="ГГГГ-ММ-ДДTЧЧ:ММ" style={{borderWidth:1,borderColor:'#E5E9EC',borderRadius:12,padding:12,fontSize:14,backgroundColor:'#fff'}} />;
}
