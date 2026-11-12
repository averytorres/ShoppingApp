(function(root){
 const DAY=86400000;
 function compare(state,client,now=Date.now()){
  const prices=(state.currentPrices||[]).filter(p=>p.client===client&&Number.isFinite(p.price)&&p.price>0&&Number.isFinite(Date.parse(p.at))&&now-Date.parse(p.at)>=0&&now-Date.parse(p.at)<=7*DAY&&(!p.validUntil||Date.parse(p.validUntil)>=now)&&p.available!==false);
  const rows=[];
  for(const group of (state.householdItems||[]).filter(g=>g.client===client&&g.kind!=='substitute')){
   const options=(state.householdVariants||[]).filter(v=>v.client===client&&v.groupId===group.id&&v.unit==='each'&&Number.isFinite(v.factor)&&v.factor>0).map(v=>{const p=prices.find(p=>p.store===v.store&&p.id===v.productId&&p.priceUnit==='each');return p?{...v,...p,normalized:p.price/v.factor}:null;}).filter(Boolean);
   const best=store=>options.filter(p=>p.store===store).sort((a,b)=>a.normalized-b.normalized)[0];const heb=best('HEB'),walmart=best('Walmart');if(!heb||!walmart)continue;
   const cheaper=heb.normalized<=walmart.normalized?heb:walmart,other=cheaper===heb?walmart:heb;
   rows.push({id:group.id,name:group.name,heb,walmart,cheaper,other,percent:100*(1-cheaper.normalized/other.normalized),saving:other.normalized-cheaper.normalized});
  }
  return rows.sort((a,b)=>b.percent-a.percent);
 }
 const api={compare};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CurrentPriceComparisons=api;
})(typeof window!=='undefined'?window:globalThis);
