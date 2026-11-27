import fs from 'fs';
// --- rng
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// --- Kim 2007 grid-free growth: like charges repel (sum of 1/r), one opposite charge pulls; pick ~ phi^eta
function grow(a,b,{h=1,eta=4,pull=1,max=4000,seed=1,local=false}){
  const R=rng(seed), key=(x,y,z)=>x+','+y+','+z;
  const A=a.map(v=>Math.round(v/h)),B=b.map(v=>Math.round(v/h));
  const pts=[],par=[],cand=new Map();const C=[];
  const add=(p,parent)=>{
    const id=pts.length;pts.push(p);par.push(parent);
    for(const c of C){const dx=c.p[0]-p[0],dy=c.p[1]-p[1],dz=c.p[2]-p[2];c.rep+=1/Math.sqrt(dx*dx+dy*dy+dz*dz)}
    for(let i=-1;i<2;i++)for(let j=-1;j<2;j++)for(let k=-1;k<2;k++){ if(!i&&!j&&!k)continue;
      const q=[p[0]+i,p[1]+j,p[2]+k],kk=key(...q); if(cand.has(kk))continue; 
      let rep=0;for(const o of pts){const dx=q[0]-o[0],dy=q[1]-o[1],dz=q[2]-o[2];const r=Math.sqrt(dx*dx+dy*dy+dz*dz);rep+=r?1/r:0}
      const dx=q[0]-B[0],dy=q[1]-B[1],dz=q[2]-B[2];
      const c={p:q,rep,att:1/Math.max(.5,Math.hypot(dx,dy,dz)),par:id};cand.set(kk,c);C.push(c)}
  };
  cand.set(key(...A),{});add(A,-1);let hit=-1;
  while(pts.length<max){
    let lo=1e9,hi=-1e9;const n=pts.length;
    for(const c of C){const f=pull*n*c.att-c.rep;c.f=f;if(f<lo)lo=f;if(f>hi)hi=f}
    let s=0;for(const c of C){c.w=Math.pow((c.f-lo)/(hi-lo||1),eta);s+=c.w}
    let t=R()*s,i=0;for(;i<C.length-1;i++){t-=C[i].w;if(t<=0)break}
    const c=C[i];C[i]=C[C.length-1];C.pop();add(c.p,c.par);
    if(Math.hypot(c.p[0]-B[0],c.p[1]-B[1],c.p[2]-B[2])<1.5){hit=pts.length-1;break}
  }
  const J=pts.map(p=>p.map(v=>(v+(R()-.5)*.9)*h));
  return{pts:J,par,hit};
}
// luminosity: 1 on the main channel, side trees by subtree size
function segs(g){const n=g.pts.length,size=new Float64Array(n).fill(1);for(let i=n-1;i>0;i--)size[g.par[i]]+=size[i];
  const main=new Uint8Array(n);let k=g.hit;while(k>=0){main[k]=1;k=g.par[k]}
  const out=[];for(let i=1;i<n;i++){const s=size[i];out.push([g.pts[g.par[i]],g.pts[i],main[i]?1:.004*Math.pow(s,.75)])}return out}
// --- NVIDIA 2007 jitter/fork
function jf(a,b,seed,{steps='FJFJJJ',dev=.16}={}){const R=rng(seed);let S=[[a,b,1,0]];
  steps.split('').forEach((m,l)=>{const O=[];for(const[p,q,w]of S){const L=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]);const d=dev*L;
    const mid=p.map((v,i)=>(v+q[i])/2+(R()-.5)*2*d);O.push([p,mid,w],[mid,q,w]);
    if(m==='F'){const t=q.map((v,i)=>mid[i]+((q[i]-mid[i])*.8+(mid[i]-p[i])*.3)+(R()-.5)*2*L*.22);O.push([mid,t,w*.18])}}S=O});return S}
// --- render: the glow of a lit segment in thin fog, closed form (asinh), plus a hot core
export function draw(S,W,H,v,{core=1.1,glow=.011}={}){const buf=new Float32Array(W*H*3);
  const P=S.map(([p,q,w])=>[v(p),v(q),w]).filter(s=>s[2]>.003);
  const bright=P.filter(s=>s[2]>.02);
  for(const[a,b,w]of P){const dx=b[0]-a[0],dy=b[1]-a[1],LL=dx*dx+dy*dy||1e-6;const wd=core*(.55+.6*Math.sqrt(w)),e=w*6;
    const x0=Math.max(0,Math.min(a[0],b[0])-8|0),x1=Math.min(W-1,Math.max(a[0],b[0])+8|0),y0=Math.max(0,Math.min(a[1],b[1])-8|0),y1=Math.min(H-1,Math.max(a[1],b[1])+8|0);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/LL));const d=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
      const c=e*Math.exp(-d*d/(wd*wd));const o=(y*W+x)*3;for(let k=0;k<3;k++)buf[o+k]=Math.max(buf[o+k],c*[1,.82,.5][k])}}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let g=0;
    for(const[a,b,w]of bright){const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1e-3;const ux=dx/L,uy=dy/L;const t=(x-a[0])*ux+(y-a[1])*uy;const d=Math.abs((x-a[0])*uy-(y-a[1])*ux)+.7;
      g+=w*(Math.asinh((L-t)/d)+Math.asinh(t/d))}
    g=g*glow;g=g*g*.55;const o=(y*W+x)*3;buf[o]+=g*1.0;buf[o+1]+=g*.5;buf[o+2]+=g*.16}
  return buf}
export function ppm(f,buf,W,H){const o=Buffer.alloc(W*H*3);for(let i=0;i<buf.length;i++){const c=1-Math.exp(-buf[i]);o[i]=255*Math.pow(c,1/2.2)}fs.writeFileSync(f,Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`),o]))}
// Yun 2017: phi = P / N, sums of (1/r)^rho; P may also hold faint residue on an old channel (Kim 2004 dart leader)
function yun(a,b,{h=1,eta=2,rho=3,max=1500,seed=1,old=[],oldQ=0}={}){
  const R=rng(seed),A=a.map(v=>Math.round(v/h)),B=b.map(v=>Math.round(v/h)),pts=[],par=[],seen=new Set(),C=[];
  const O=old.map(p=>p.map(v=>v/h));const pw=r2=>Math.pow(r2,-rho/2);
  const d2=(p,q)=>(p[0]-q[0])**2+(p[1]-q[1])**2+(p[2]-q[2])**2;
  const add=(p,parent)=>{const id=pts.length;pts.push(p);par.push(parent);
    for(const c of C)c.N+=pw(d2(c.p,p));
    for(let i=-1;i<2;i++)for(let j=-1;j<2;j++)for(let k=-1;k<2;k++){if(!i&&!j&&!k)continue;const q=[p[0]+i,p[1]+j,p[2]+k],kk=q.join();if(seen.has(kk))continue;seen.add(kk);
      let N=0;for(const o of pts)N+=pw(d2(q,o));let P=pw(Math.max(.25,d2(q,B)));
      if(oldQ){let s=1e9;for(const o of O)s=Math.min(s,d2(q,o));P*=1+oldQ*Math.exp(-s/4)}
      C.push({p:q,N,P,par:id})}};
  seen.add(A.join());add(A,-1);let hit=-1;
  while(pts.length<max){let lo=1e99,hi=-1e99;for(const c of C){c.f=c.P/c.N;if(c.f<lo)lo=c.f;if(c.f>hi)hi=c.f}
    let s=0;for(const c of C){c.w=Math.pow((c.f-lo)/(hi-lo||1),eta);s+=c.w}let t=R()*s,i=0;for(;i<C.length-1;i++){t-=C[i].w;if(t<=0)break}
    const c=C[i];C[i]=C[C.length-1];C.pop();add(c.p,c.par);if(d2(c.p,B)<2.3){hit=pts.length-1;break}}
  return{pts:pts.map(p=>p.map(v=>(v+(R()-.5)*.9)*h)),par,hit}}
const path=g=>{const o=[];let k=g.hit;while(k>=0){o.push(g.pts[k]);k=g.par[k]}return o.reverse()};
const W=460,H=760,a=[0,150,0],b=[12,-150,0],view=p=>[W/2+p[0]*2.1,H/2-p[1]*2.2];
const run=(name,f)=>{const t=performance.now();const S=f();console.log(name,S.length,'segs',(performance.now()-t).toFixed(0)+'ms');ppm(name+'.ppm',draw(S,W,H,view,{glow:.032}),W,H)};
for(const[eta,rho]of[[3,2],[4,3],[6,2],[8,3]])run(`y_${eta}_${rho}`,()=>{const g=yun(a,b,{h:3,eta,rho,seed:4});console.log(' hit',g.hit);return segs(g)});
const w=[[-60,150,0],[35,95,20],[-50,45,-10],[40,0,15],[-20,-40,0],[70,-75,-10],[20,-150,0]];
const chain=(seed,o={})=>{let S=[],P=[];for(let i=0;i<w.length-1;i++){const g=yun(w[i],w[i+1],{h:2,eta:5,rho:2,max:900,seed:seed+i,...o});S.push(...segs(g));P.push(...path(g))}return[S,P]};
let keep;run('z_way',()=>{const[S,P]=chain(50);keep=P;return S});
run('z_way2',()=>chain(90,{old:keep,oldQ:3})[0]);
run('z_way3',()=>chain(130,{old:keep,oldQ:3})[0]);
