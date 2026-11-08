const $=id=>document.getElementById(id);
const fmt=x=>Number(x).toLocaleString('ko-KR',{maximumFractionDigits:3});
let worker, nextId=0, requests=new Map(), sectors=[], rowChoices=[], cells=[], basket=[], result=null;
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function call(type,payload){return new Promise((resolve,reject)=>{const id=++nextId;requests.set(id,{resolve,reject});worker.postMessage({id,type,payload});});}
function startWorker(){worker=new Worker('./worker.js');worker.onmessage=({data:d})=>{if(d.type==='status'){$('status').textContent=d.text;return;}const p=requests.get(d.id);if(!p)return;requests.delete(d.id);d.ok?p.resolve(d.result):p.reject(Error(d.error));};worker.onerror=e=>{for(const p of requests.values())p.reject(Error(e.message||'Worker 실행 오류'));requests.clear();};}
function options(el,list){el.replaceChildren(...list.map(x=>{const o=document.createElement('option');o.value=x.code;o.textContent=x.code+' '+x.name;return o;}));}
function invalidate(){result=null;$('results').hidden=true;}
async function load(buffer){
 invalidate();basket=[];renderBasket();
 for(const id of ['sheet','row','sector','add','run','row-search','col-search','sector-search','amount'])$(id).disabled=true;
 if(worker)worker.terminate();for(const p of requests.values())p.reject(Error('데이터 다시 로드'));requests.clear();startWorker();
 try{const info=await call('init',buffer);sectors=info.sectors;options($('sector'),sectors);$('sector-search').value='';$('row-search').value='';$('col-search').value='';$('sheet').replaceChildren(...info.sheets.map(s=>{const o=text('option',s);o.value=s;return o;}));
 $('validation').textContent=JSON.stringify(info.residuals,null,2)+'\n최대 절대 잔차: 허용값 1e-8 미만';
 for(const id of ['sheet','row','sector','add','run','row-search','col-search','sector-search','amount'])$(id).disabled=false;
 await explore();$('status').textContent='준비 완료 · '+sectors.length+'개 부문 · '+info.sheets.length+'개 시트 · 계수 검증 통과';
 }catch(e){$('status').textContent='준비 실패: '+e.message+' — 새로고침 후 재시도하세요.';}
}
let exploreSeq=0;
async function explore(){const seq=++exploreSeq;try{const d=await call('explore',{sheet:$('sheet').value,row:$('row').value});if(seq!==exploreSeq)return;rowChoices=d.rows;filterRows(d.selected);cells=d.cells;$('unit').textContent=d.unit;$('explore-caption').textContent=$('sheet').value+' / 행: '+d.selected+' '+d.name;renderCells();}catch(e){$('status').textContent=e.message;}}
function filterRows(selected){const q=$('row-search').value.trim();options($('row'),rowChoices.filter(r=>(r.code+' '+r.name).includes(q)));if([...$('row').options].some(o=>o.value===selected))$('row').value=selected;}
function renderCells(){const q=$('col-search').value.trim();$('cells').replaceChildren(...cells.filter(c=>(c.code+' '+c.name).includes(q)).map(c=>{const tr=document.createElement('tr');for(const v of [c.code,c.name,c.value===null?'빈 셀':typeof c.value==='number'?fmt(c.value):c.value])tr.append(text('td',v));return tr;}));}
$('sheet').onchange=()=>{$('row-search').value='';$('row').replaceChildren();explore();};$('row').onchange=explore;
$('row-search').oninput=()=>{filterRows();if($('row').value)explore();else{$('cells').replaceChildren();$('explore-caption').textContent='일치하는 행이 없습니다.';}};
$('col-search').oninput=renderCells;
$('sector-search').oninput=()=>{const q=$('sector-search').value.trim();options($('sector'),sectors.filter(s=>(s.code+' '+s.name).includes(q)));};
function renderBasket(){$('basket').replaceChildren(...basket.map((s,i)=>{const li=text('li',s.code+' '+s.name+' / '+fmt(s.amount)+'백만원 ');const b=text('button','삭제');b.type='button';b.onclick=()=>{basket.splice(i,1);invalidate();renderBasket();};li.append(b);return li;}));$('sim-status').textContent=basket.length?basket.length+'개 입력 준비. 계산 버튼을 누르세요.':'시나리오를 추가하세요.';}
$('scenario').onsubmit=e=>{e.preventDefault();const amount=Number($('amount').value),s=sectors.find(s=>s.code===$('sector').value);if(!s||!Number.isFinite(amount)||amount<=0){$('sim-status').textContent='산업과 양의 증가액을 확인하세요.';return;}basket.push({...s,amount});invalidate();renderBasket();};
$('clear').onclick=()=>{basket=[];invalidate();renderBasket();};
$('run').onclick=async()=>{if(!basket.length){$('sim-status').textContent='시나리오를 먼저 추가하세요.';return;}const snapshot=basket.map(s=>({...s}));$('run').disabled=true;$('sim-status').textContent='계산 중…';try{const r=await call('simulate',snapshot);if(JSON.stringify(snapshot)!==JSON.stringify(basket)){$('sim-status').textContent='입력이 변경되었습니다. 다시 계산하세요.';return;}result=r;renderResult();$('sim-status').textContent='계산 완료. 아래 결과는 현재 시나리오에 대응합니다.';}catch(e){invalidate();$('sim-status').textContent='계산 실패: '+e.message;}finally{$('run').disabled=false;}};
function renderResult(){$('results').hidden=false;$('cards').replaceChildren(...[['수요 증가액',result.demand],['생산유발액',result.production],['수입유발액',result.imports],['부가가치유발액',result.valueAdded]].map(([title,v])=>{const d=text('div',title);d.className='card';d.append(text('strong',fmt(v)),text('span','백만원'));return d;}));const max=Math.max(...result.rows.map(r=>r.production),1);$('bars').replaceChildren(...result.rows.slice(0,15).map(r=>{const d=text('div',r.name+' · '+fmt(r.production)+'백만원');d.className='bar';const t=document.createElement('div');t.className='track';const f=document.createElement('div');f.className='fill';f.style.width=Math.max(0,r.production/max*100)+'%';t.append(f);d.append(t);return d;}));$('result-rows').replaceChildren(...result.rows.map(r=>{const tr=document.createElement('tr');[r.code,r.name,fmt(r.production),fmt(r.imports),fmt(r.valueAdded)].forEach(v=>tr.append(text('td',v)));return tr;}));}
function csvCell(v){let s=String(v);if(/^[=+@-]/.test(s)&&typeof v!=='number')s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
$('download').onclick=()=>{if(!result)return;const rows=[['산업코드','산업명','생산유발액_백만원','수입유발액_백만원','부가가치유발액_백만원'],...result.rows.map(r=>[r.code,r.name,r.production,r.imports,r.valueAdded])];const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='io-2023-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

async function loadDefaultWorkbook(){
 try {
  $('status').textContent='기본 Excel 내려받는 중…';
  const response=await fetch('./data/io-2023.xlsx');
  if(!response.ok)throw Error('기본 Excel 다운로드 실패 (HTTP '+response.status+')');
  await load(await response.arrayBuffer());
 }catch(error){
  $('status').textContent='준비 실패: '+error.message+' — 연결 상태를 확인하고 새로고침하세요.';
 }
}
$('load-basic').onclick=async()=>{
 const button=$('load-basic');
 button.disabled=true;
 button.textContent='불러오는 중…';
 try {
  await loadDefaultWorkbook();
  const ready=!$('sheet').disabled;
  button.textContent=ready?'기본부문 불러오기 완료':'기본부문 다시 불러오기';
  button.disabled=ready;
 }finally{
  if($('sheet').disabled){button.disabled=false;button.textContent='기본부문 다시 불러오기';}
 }
};
