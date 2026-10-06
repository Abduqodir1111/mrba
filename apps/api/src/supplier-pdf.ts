import PDFDocument from "pdfkit";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
const D = Prisma.Decimal;
const num = (value: any) => new D(value ?? 0).toDecimalPlaces(2).toFixed().replace(/\B(?=(\d{3})+(?!\d))/g, " ").replace(".", ",");
const timestamp = (value: any) => new Date(value).toLocaleString("ru-RU", {timeZone:"Asia/Tashkent",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
export async function supplierPdf(lines: any[], supplier: string, from?: string, to?: string): Promise<Buffer> {
  const doc = new PDFDocument({size:"A4",layout:"landscape",margin:32,bufferPages:true,info:{Title:`Расчёт с поставщиком - ${supplier}`,Author:"MRBA"}});
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {doc.on("data", chunk => chunks.push(chunk));doc.on("end", () => resolve(Buffer.concat(chunks)));doc.on("error",reject);});
  doc.registerFont("regular",resolve(__dirname,"../assets/fonts/DejaVuSans.ttf"));
  doc.registerFont("bold",resolve(__dirname,"../assets/fonts/DejaVuSans-Bold.ttf"));
  const left=32, width=doc.page.width-64, bottom=doc.page.height-46;
  let y=32;
  const text = (value:string,size=10,bold=false) => {
    doc.font(bold?"bold":"regular").fontSize(size).fillColor("#172D40");
    const height=doc.heightOfString(value,{width});
    if(y+height>bottom){doc.addPage();y=32;}
    doc.text(value,left,y,{width});y+=height+8;
  };
  text("MRBA  /  РАСЧЁТ С ПОСТАВЩИКОМ",18,true);
  text(`Поставщик: ${supplier}`,12,true);
  text(`Период: ${from ? timestamp(from) : "с начала учёта"} - ${to ? timestamp(to) : "по настоящее время"}. Время Ташкента.`,9);
  text(`Сформировано: ${timestamp(new Date())}. Вес указан в кг.`,8);
  const table = (headers:string[], rows:string[][], proportions:number[]) => {
    const widths=proportions.map(v=>v*width/proportions.reduce((a,b)=>a+b,0));
    const draw = (values:string[], header=false, total=false) => {
      doc.font(header||total?"bold":"regular").fontSize(7.5);
      const height=Math.max(header?34:26,...values.map((value,i)=>doc.heightOfString(value,{width:widths[i]-10})+12));
      let x=left;
      values.forEach((value,i)=>{
        doc.rect(x,y,widths[i],height).fillAndStroke(header?"#E9F0FA":total?"#EEF5FC":"#FFFFFF","#D9E2EB");
        doc.fillColor("#172D40").text(value,x+5,y+6,{width:widths[i]-10,align:i>2?"right":"left"});
        x+=widths[i];
      });
      y+=height;
    };
    if(y+65>bottom){doc.addPage();y=32;}
    draw(headers,true);
    rows.forEach((row,index)=>{
      doc.font(index===rows.length-1?"bold":"regular").fontSize(7.5);
      const height=Math.max(26,...row.map((value,i)=>doc.heightOfString(value,{width:widths[i]-10})+12));
      if(y+height>bottom){doc.addPage();y=32;draw(headers,true);}
      draw(row,false,index===rows.length-1);
    });
    y+=14;
  };
  for(const currency of [...new Set<string>(lines.map(line=>line.currency))]) {
    const items=lines.filter(line=>line.currency===currency);
    const sum=(field:string)=>items.reduce((total,line)=>total.plus(line[field]??0),new D(0));
    const clean=(line:any)=>new D(line.quantityKg).minus(line.discountKg).minus(line.percentDiscountKg);
    const amount=items.filter(line=>line.priceKnown).reduce((total,line)=>total.plus(line.amount),new D(0));
    const missing=items.some(line=>!line.priceKnown);
    text(`Поступления / ${currency}`,11,true);
    const rows=items.map(line=>[
      `${timestamp(line.receipt.postedAt)}\nПриход №${line.receipt.number}`,
      line.receipt.deliveredBy||"Не указан",line.material.name,
      num(new D(line.quantityKg).plus(line.returnedKg)),num(line.returnedKg),num(line.discountKg),`${num(line.discountPercent)}%`,num(line.percentDiscountKg),num(clean(line)),line.priceKnown?num(line.unitPricePerKg):"Не указана",line.priceKnown?num(line.amount):"Не определена",
    ]);
    rows.push(["ИТОГО","","",num(sum("quantityKg").plus(sum("returnedKg"))),num(sum("returnedKg")),num(sum("discountKg")),"",num(sum("percentDiscountKg")),num(items.reduce((total,line)=>total.plus(clean(line)),new D(0))),"",`${num(amount)}${missing?" *":""}`]);
    table(["Дата / приход","Кто привёз","Сырьё","Получено","Возврат","Скидка кг","Скидка %","Скидка % в кг","Чистыми","Цена за кг","Сумма"],rows,[78,68,86,52,44,48,40,52,60,70,116]);
    text(`Итоги по сырью / ${currency}`,11,true);
    const materials=new Map<string,any[]>();
    for(const line of items){const group=materials.get(line.materialId)||[];group.push(line);materials.set(line.materialId,group);}
    const summary=[...materials.values()].sort((a,b)=>a[0].material.name.localeCompare(b[0].material.name,"ru")).map(group=>{
      const total=(field:string)=>group.reduce((sum,line)=>sum.plus(line[field]??0),new D(0));
      return [group[0].material.name,num(total("quantityKg").plus(total("returnedKg"))),num(total("returnedKg")),num(total("discountKg")),num(total("percentDiscountKg")),num(group.reduce((sum,line)=>sum.plus(clean(line)),new D(0))),`${num(group.filter(line=>line.priceKnown).reduce((sum,line)=>sum.plus(line.amount),new D(0)))}${group.some(line=>!line.priceKnown)?" *":""}`];
    });
    summary.push(["ИТОГО",num(sum("quantityKg").plus(sum("returnedKg"))),num(sum("returnedKg")),num(sum("discountKg")),num(sum("percentDiscountKg")),num(items.reduce((total,line)=>total.plus(clean(line)),new D(0))),`${num(amount)}${missing?" *":""}`]);
    table(["Сырьё","Получено","Возврат","Скидка кг","Процентная скидка кг","Чистыми","Сумма"],summary,[160,100,90,90,110,100,144]);
    text(`${missing?"Сумма по указанным ценам":"Начислено к оплате"}: ${num(amount)} ${currency}`,13,true);
    if(missing)text("* Итог неполный: есть поступления без цены. Укажите цены перед окончательным расчётом.",9,true);
  }
  text("Чистыми = получено минус возврат, скидка в кг и процентная скидка в кг. Сумма каждой строки рассчитана по цене её поступления.",8);
  text("Документ отражает начисления за выбранный период. Уже выполненные оплаты и авансы не учитываются. Расход в производство не уменьшает сумму закупки.",8);
  const range=doc.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++){
    doc.switchToPage(i);doc.page.margins.bottom=0;
    doc.font("regular").fontSize(8).fillColor("#718397").text(`MRBA - Расчёт с поставщиком | Страница ${i+1} из ${range.count}`,32,doc.page.height-25,{width,align:"right",lineBreak:false});
  }
  doc.end();return result;
}
