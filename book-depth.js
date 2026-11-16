/* Shared depth pass for the milled paper, the ink printed on it, and the
 * exposed/turning leaves. All vertices use the calibrated book lens. */
(function(root,factory){
  const n=typeof module==='object'&&module.exports;
  const api=factory(n?require('./book-kinematics.js'):root.PaperBookKinematics,
    n?require('./book-solid.js'):root.PaperBookSolid);
  if(n)module.exports=api;else root.PaperBookDepth=api;
})(typeof window!=='undefined'?window:globalThis,function(K,Solid){
  'use strict';
  const R=Solid.RASTER, clamp=(n,a,b)=>Math.max(a,Math.min(b,n)), mix=(a,b,t)=>a+(b-a)*t;
  const COLUMNS=8,TILE_W=128,TILE_H=152,STRIDE=11;
  // Size the source ink as well as the output buffer. A high-DPR framebuffer
  // cannot restore strokes from a twenty-pixel, four-book stamp.
  function atlasRaster(count,limit=4096){
    const rows=Math.max(1,Math.ceil(count/COLUMNS)),w=COLUMNS*TILE_W,h=2*rows*TILE_H;
    const scale=Math.min(2.25,limit/w,limit/h);
    return {width:Math.floor(w*scale),height:Math.floor(h*scale),scaleX:Math.floor(w*scale)/w,scaleY:Math.floor(h*scale)/h};
  }
  function inspectionGlyph(n,label){
    const count=n.indices.length,chars=Math.max(1,[...label].length);
    const height=count===1?.37:count===2?.28:.62/count;
    // Estimate the paper-tip tangent, then compensate the narrow substrate,
    // not the finished screen. Keep a single character the same width as one
    // character in a pair; never stretch '犹' to the width of '约三'.
    const tangent=1+K.WIDTH*K.EDGE_SWEEP/36;
    const width=Math.min(count>=4?.56:count===3?.62:.68,height*2*n.radius/(2.1*n.span*tangent)*chars);
    return {height,width};
  }
  const unique=xs=>[...new Set(xs.map(x=>+x.toFixed(9)))].sort((a,b)=>a-b);
  const tone=(n,s,y)=>{
    const q=Math.abs((s-n.depth)/n.span),v=Math.abs((y-n.y)/n.radius);
    const cut=Math.max(0,1-v*v);
    // Thin bright cut fibres at the rim, warm deeper fibres at the floor.
    const rim=Math.max(q,v);
    return rim>=1?0:Math.min(.999,.24+.76*Math.pow(cut,.24)*Math.pow(1-q,.27));
  };
  function milling(model){
    return model.groups.map(g=>{
      const n=g.notch,d=model.totalDepth;
      const paired=g.indices.some(i=>[...model.slots[i].label].length>1);
      const span=Math.min(d*.48,Math.max(paired?2.4:1.46,n.span*1.16));
      // Dense names get room in the real cut, not an overlaid label. The
      // vertical centre/order and each book's opening depth stay unchanged.
      const radius=Math.max(n.radius,g.indices.length>=3?g.indices.length*5.2:13);
      return {...n,depth:clamp(n.depth,span*1.02,d-span*1.02),span,radius,milled:true,
        inset:Math.min(15,10.8+(n.radius-13)*.38),group:g.index,indices:g.indices,testament:g.testament};
    });
  }
  function topology(total,notches){
    const knots=[-1,-.88,-.65,-.42,0,.42,.65,.88,1];
    const depths=unique([0,total,...Array.from({length:11},(_,i)=>total*i/10),
      ...notches.flatMap(n=>knots.map(q=>clamp(n.depth+n.span*q,0,total)))]);
    return depths.slice(1).map((hi,i)=>{
      const lo=depths[i],active=notches.filter(n=>n.depth+n.span>lo+1e-8&&n.depth-n.span<hi-1e-8);
      const ys=unique([0,K.HEIGHT,...active.flatMap(n=>Array.from({length:9},(_,j)=>
        clamp(n.y-n.radius*Math.cos(Math.PI*j/8),0,K.HEIGHT)))]);
      const cuts=ys.slice(1).map((y1,j)=>{
        const y0=ys[j],y=(y0+y1)/2,s=(lo+hi)/2;let n=null,strength=0;
        for(const candidate of active){
          const value=tone(candidate,s,y);if(value<=strength)continue;
          n=candidate;strength=value;
        }
        return n;
      });
      return {lo,hi,ys,cuts};
    });
  }
  // The stamp is part of the far shoulder triangles: zero lift, zero
  // duplicate coplanar card. The near shoulder remains opaque paper.
  function stampUV(n,s,y,side){
    const vertical=Math.sqrt(Math.max(.00001,1-((y-n.y)/n.radius)**2));
    const q=(s-n.depth)/(n.span*vertical)*(side==='left'?-1:1);
    const t=clamp((q-.42)/.58,0,1),u=.12*t+.88*(1-Math.sqrt(1-t*t));
    return [side==='left'?1-u:u,clamp((y-(n.y-n.radius))/(2*n.radius),0,1)];
  }
  function atlasUV(n,u,v,rows,inspection=false){
    return [((n.group%COLUMNS)*TILE_W+2+u*(TILE_W-4))/(COLUMNS*TILE_W),
      ((Math.floor(n.group/COLUMNS)+(inspection?rows:0))*TILE_H+2+v*(TILE_H-4))/(2*rows*TILE_H)];
  }
  function projectTriangle(tri){
    const p=tri.points.map(Solid.project),xs=p.map(v=>v.x),ys=p.map(v=>v.y);
    return {...tri,p,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};
  }
  function atPixel(tri,x,y){
    const [minX,minY,maxX,maxY]=tri.bounds;if(x<minX||x>maxX||y<minY||y>maxY)return null;
    const [a,b,c]=tri.p,det=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(det)<1e-8)return null;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/det;
    const v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/det;
    const w=1-u-v;if(u< -1e-6||v< -1e-6||w< -1e-6)return null;
    // Undo the same homogeneous lens used by the GPU for hit testing.
    const a0=u/(1-a.z/R.PERSPECTIVE),b0=v/(1-b.z/R.PERSPECTIVE),c0=w/(1-c.z/R.PERSPECTIVE),sum=a0+b0+c0;
    return {z:(a.z*a0+b.z*b0+c.z*c0)/sum,v:tri.meta?(tri.meta[0][1]*a0+tri.meta[1][1]*b0+tri.meta[2][1]*c0)/sum:0};
  }
  function frontAt(tris,x,y){
    let best=null;
    for(const tri of tris){const at=atPixel(tri,x,y);if(at&&(!best||at.z>best.z))best={...at,tri};}
    return best;
  }
  // Keep native-density pixels for the window being inspected, not an
  // oversized backing buffer for the whole 1080×1080 book world.
  function rasterRegion(fineView,dpr=1,limit=4096){
    const complete={x:-R.LEFT,y:-R.TOP,w:R.WIDTH,h:R.HEIGHT};
    let region=complete,requested=clamp(dpr,1,1.6);
    const f=fineView?.camera,w=fineView?.w,h=fineView?.h;
    if(f?.scale>0&&w>0&&h>0){
      const tile=32,margin=12/f.scale;
      const x0=Math.floor((-f.x/f.scale-margin)/tile)*tile;
      const y0=Math.floor((-f.y/f.scale-margin)/tile)*tile;
      const x1=Math.ceil(((w-f.x)/f.scale+margin)/tile)*tile;
      const y1=Math.ceil(((h-f.y)/f.scale+margin)/tile)*tile;
      const x=Math.max(complete.x,x0),y=Math.max(complete.y,y0);
      const right=Math.min(complete.x+complete.w,x1),bottom=Math.min(complete.y+complete.h,y1);
      if(right>x&&bottom>y)region={x,y,w:right-x,h:bottom-y};
      requested=Math.max(requested,f.scale*clamp(dpr,1.25,3));
    }
    const ratio=Math.min(requested,limit/Math.max(region.w,region.h),Math.sqrt(3600000/(region.w*region.h)));
    return {...region,px:Math.max(1,Math.floor(region.w*ratio)),py:Math.max(1,Math.floor(region.h*ratio))};
  }
  const VS=`attribute vec3 a_pos;attribute vec2 a_uv;attribute vec4 a_paper;attribute vec2 a_floor;
    uniform vec4 u_region;
    varying vec2 uv;varying vec2 floorUV;varying vec4 paper;
    void main(){
      float w=1.0-a_pos.z/1800.0;
      vec2 pivot=(vec2(480.0,352.0)-u_region.xy)/u_region.zw;
      vec2 clip=2.0*(a_pos.xy-vec2(480.0,352.0))/u_region.zw+(2.0*pivot-1.0)*w;
      gl_Position=vec4(clip.x,-clip.y,-a_pos.z/1100.0,w);
      uv=a_uv;floorUV=a_floor;paper=a_paper;
    }`;
  const FS=`#extension GL_OES_standard_derivatives : enable
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 uv;varying vec2 floorUV;varying vec4 paper;
    uniform sampler2D u_tex;uniform float u_stamp;uniform float u_sheets;uniform float u_closed;uniform float u_inspect;
    void main(){
      if(paper.w>2.5){
        if((paper.w>3.5)!=gl_FrontFacing)discard;
        gl_FragColor=vec4(texture2D(u_tex,uv).rgb*paper.z,1.0);return;
      }
      if(paper.w>1.5){gl_FragColor=vec4(.36,.19,.22,1.0);return;}
      float layer=paper.x*u_sheets;
      float line=1.0-smoothstep(.025,.26,abs(fract(layer+.5)-.5));
      #ifdef GL_OES_standard_derivatives
      line*=1.0-smoothstep(.22,1.0,fwidth(layer));
      #endif
      float irregular=.009*sin(layer*.29)+.006*sin(layer*.67);
      float grain=1.0-smoothstep(.04,.29,abs(fract(layer/3.0+.5)-.5));
      #ifdef GL_OES_standard_derivatives
      grain*=1.0-smoothstep(.32,.94,fwidth(layer)/3.0);
      #endif
      vec3 tinted=mix(vec3(.913,.705,.721),vec3(.943,.867,.830),step(.5,paper.w));
      vec3 fibre=vec3(.991,.955,.884);
      vec3 stock=mix(tinted,fibre,smoothstep(.025,.80,paper.y));
      stock*=paper.z+irregular-line*.14-grain*.052;
      vec4 ink=texture2D(u_tex,uv);
      float stamp=paper.w>.05&&paper.w<.15?1.0:
        paper.w>=.15&&paper.w<.25?u_closed:
        paper.w>=.25&&paper.w<.35?1.0-u_closed:0.0;
      vec4 inlay=texture2D(u_tex,floorUV);
      // The inspected glyph follows the whole recessed floor. Keep the lip
      // clean; neither of these atlas samples projects beyond the cut mesh.
      float edge=smoothstep(.025,.32,paper.y);
      float shoulderAlpha=ink.a*stamp*edge;
      float floorAlpha=inlay.a*smoothstep(.09,.53,paper.y);
      vec3 shoulder=mix(stock,ink.rgb*(.91+.09*paper.z),u_stamp*shoulderAlpha);
      // Bright sliced fibres surround the shade on the recessed floor,
      // even when viewing the fore-edge straight on and hiding its ink.
      float cavity=smoothstep(.0,.91,paper.y);
      vec3 recess=mix(tinted,fibre*(1.0-.23*cavity),smoothstep(.035,.47,paper.y));
      recess*=.99+irregular-line*.14-grain*.052;
      vec3 floorInk=mix(recess,inlay.rgb,u_stamp*floorAlpha);
      gl_FragColor=vec4(mix(shoulder,floorInk,u_inspect),1.0);
    }`;
  function compile(gl,type,src){
    const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;
  }
  function initGL(canvas){
    const gl=canvas.getContext('webgl',{alpha:true,depth:true,antialias:true,premultipliedAlpha:false});
    if(!gl)return null;
    const derivatives=gl.getExtension('OES_standard_derivatives');
    const program=gl.createProgram();
    gl.attachShader(program,compile(gl,gl.VERTEX_SHADER,VS));
    gl.attachShader(program,compile(gl,gl.FRAGMENT_SHADER,derivatives?FS:FS.slice(FS.indexOf('\n')+1)));
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    [['a_pos',3,0],['a_uv',2,3],['a_paper',4,5],['a_floor',2,9]].forEach(([name,size,offset])=>{
      const at=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at,size,gl.FLOAT,false,STRIDE*4,offset*4);
    });
    gl.clearColor(0,0,0,0);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    const stamp=gl.getUniformLocation(program,'u_stamp'),sheets=gl.getUniformLocation(program,'u_sheets'),closed=gl.getUniformLocation(program,'u_closed');
    const region=gl.getUniformLocation(program,'u_region'),inspect=gl.getUniformLocation(program,'u_inspect');
    function texture(canvas){
      const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
      for(const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
      for(const filter of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,filter,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);return t;
    }
    return {gl,texture,draw(batch,tex){
      gl.bindTexture(gl.TEXTURE_2D,tex);gl.bufferData(gl.ARRAY_BUFFER,batch,gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES,0,batch.length/STRIDE);
    },begin(fade,count,closure,inspection,window){
      gl.uniform4f(region,window.x,window.y,window.w,window.h);gl.uniform1f(inspect,inspection);
      gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(stamp,fade);gl.uniform1f(sheets,count);gl.uniform1f(closed,closure);
    }};
  }
  class Batch{
    constructor(size){this.data=new Float32Array(size);this.length=0;}
    push(x,y,z,u,v,s,ink,light,kind,fu=.0001,fv=.0001){
      let i=this.length;
      if(i+STRIDE>this.data.length){const next=new Float32Array(this.data.length*2);next.set(this.data);this.data=next;}
      const d=this.data;d[i++]=x;d[i++]=y;d[i++]=z;d[i++]=u;d[i++]=v;
      d[i++]=s;d[i++]=ink;d[i++]=light;d[i++]=kind;d[i++]=fu;d[i++]=fv;this.length=i;
    }
    view(){return this.data.subarray(0,this.length);}
  }
  function create({host,model,notches,paintPage,onContextLoss}){
    const doc=host.ownerDocument,canvas=doc.createElement('canvas');
    let gpu;
    try{gpu=initGL(canvas);}catch(error){console.warn('纸层深度绘图不可用',error.message);}
    if(!gpu)return null;
    const {gl}=gpu,bands=topology(model.totalDepth,notches);
    const limit=Math.min(4096,gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    const rows=Math.ceil(notches.length/COLUMNS),atlas=doc.createElement('canvas');
    const inkRaster=atlasRaster(notches.length,gl.getParameter(gl.MAX_TEXTURE_SIZE));
    atlas.width=inkRaster.width;atlas.height=inkRaster.height;
    let atlasTexture=null,dirty=true,pages=new Map(),last=null,lastKey='',lastGeometry='',lastLayers=null,projected=new Map(),targets=[],cost={};
    const body=new Batch(4096),pageBatches=Array.from({length:4},()=>new Batch(4096)),meshes=new Map();
    const atlasPaint=atlas.getContext('2d');
    function printAtlas(){
      atlasPaint.clearRect(0,0,atlas.width,atlas.height);
      atlasPaint.save();atlasPaint.scale(inkRaster.scaleX,inkRaster.scaleY);
      for(const inspection of [false,true])for(const n of notches){
        const x=n.group%COLUMNS*TILE_W+2,y=(Math.floor(n.group/COLUMNS)+(inspection?rows:0))*TILE_H+2;
        const w=TILE_W-4,h=TILE_H-4;
        atlasPaint.save();atlasPaint.translate(x,y);
        atlasPaint.beginPath();
        if(inspection)atlasPaint.ellipse(w*.5,h*.5,w*.44,h*.46,0,0,2*Math.PI);
        else {
          atlasPaint.moveTo(w*.25,h*.50);
          atlasPaint.bezierCurveTo(w*.24,h*.235,w*.52,h*.09,w*.94,h*.082);
          atlasPaint.lineTo(w*.94,h*.935);
          atlasPaint.bezierCurveTo(w*.52,h*.91,w*.24,h*.765,w*.25,h*.50);
        }
        atlasPaint.closePath();
        // Both left/right shoulders sample this same registered ink. Keep
        // natural glyphs in the atlas; only the projection can foreshorten.
        atlasPaint.fillStyle=n.testament==='new'?'#932d31':'#282c27';atlasPaint.fill();
        atlasPaint.clip();
        const local=atlasPaint.createLinearGradient(0,0,w,0);
        local.addColorStop(0,n.testament==='new'?'#661e26':'#181d18');
        local.addColorStop(.61,n.testament==='new'?'#a93d3b':'#343932');
        local.addColorStop(1,n.testament==='new'?'#882529':'#212721');
        atlasPaint.fillStyle=local;atlasPaint.fillRect(0,0,w,h);
        atlasPaint.textAlign='center';atlasPaint.textBaseline='middle';
        n.indices.forEach((i,j)=>{
          const slot=model.slots[i],yy=h*(.5+(j-(n.indices.length-1)/2)*(.69/n.indices.length));
          if(j){atlasPaint.fillStyle='#dabb755c';atlasPaint.fillRect(w*(inspection?.15:.33),yy-h*.345/n.indices.length,w*(inspection?.70:.51),1);}
          atlasPaint.fillStyle=inspection?'#fff0bc':'#f9e6ac';
          const glyph=inspectionGlyph(n,slot.label);
          const size=Math.min(94,h*(inspection?glyph.height:(n.indices.length===1?.52:.61/n.indices.length)));
          atlasPaint.font=inspection?`600 ${size}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`:`600 ${size}px PaperSerif,"Microsoft YaHei",serif`;
          if(inspection){
            // The floor is a tall, narrow surface. A wider ink master on
            // the substrate counteracts its smaller horizontal projection.
            const inkWidth=atlasPaint.measureText(slot.label).width||1;
            atlasPaint.save();atlasPaint.translate(w*.5,yy);
            atlasPaint.scale(w*glyph.width/inkWidth,1);
            atlasPaint.fillText(slot.label,0,0);atlasPaint.restore();
          }else atlasPaint.fillText(slot.label,w*.64,yy,w*.60);
        });
        atlasPaint.restore();
      }
      atlasPaint.restore();
      if(atlasTexture)gl.deleteTexture(atlasTexture);atlasTexture=gpu.texture(atlas);dirty=false;
    }
    function page(index){
      if(pages.has(index)){const hit=pages.get(index);pages.delete(index);pages.set(index,hit);return hit;}
      const c=doc.createElement('canvas'),scale=2;c.width=K.WIDTH*scale;c.height=K.HEIGHT*scale;paintPage(c,index,scale);
      const tex=gpu.texture(c);pages.set(index,tex);
      if(pages.size>6){const oldest=pages.keys().next().value;gl.deleteTexture(pages.get(oldest));pages.delete(oldest);}
      return tex;
    }
    canvas.className='bs-raster';canvas.setAttribute('aria-hidden','true');
    canvas.style.transform=`translateZ(${R.BACK}px) scale(${1-R.BACK/R.PERSPECTIVE})`;
    let activeRegion='';
    function useRegion(r,key){
      if(key===activeRegion)return;activeRegion=key;
      if(canvas.width!==r.px)canvas.width=r.px;if(canvas.height!==r.py)canvas.height=r.py;
      Object.assign(canvas.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px',
        transformOrigin:(R.CX-r.x)+'px '+(R.CY-r.y)+'px'});
      host.dataset.paperRaster=[r.px,r.py].join('x');
    }
    host.classList.add('book-solid','book-solid-raster');host.dataset.renderer='shared-depth';host.appendChild(canvas);
    let lost=false;
    function cells(band,a,b,side,pointSource){
      let y0,y1;
      const result=[];
      for(let j=0;j<band.cuts.length;j++){
        y0=band.ys[j];y1=band.ys[j+1];const n=band.cuts[j],mid=(a+b)/2;
        if(!n){while(j+1<band.cuts.length&&!band.cuts[j+1])y1=band.ys[++j+1];}
        const q=n?(mid-n.depth)/n.span:0;
        const stampSide=q<-.42?'left':q>.42?'right':null;
        const far=side===stampSide;
        const verts=[[a,y0],[b,y0],[b,y1],[a,y1]];
        const meta=verts.map(([s,y])=>{
          const [u,v]=n?stampUV(n,s,y,stampSide||side):[0,0];
          const cut=n?pointSource.edgeInset(side,s,y):0;
          const c=n?tone(n,s,y):0,tint=n?clamp(cut/(n.inset*.74),0,1):0;
          const light=n?(far?1-.22*tint:1+.035*c-.025*tint):.995;
          return [u,v,s,[tint,light]];
        });
        result.push({verts,meta,n,stampSide});
      }
      return result;
    }
    function edgeMesh(lo,hi,side){
      const key=[lo,hi,side].join(',');
      if(meshes.has(key)){const hit=meshes.get(key);meshes.delete(key);meshes.set(key,hit);return hit;}
      const batch=new Batch(24000+Math.ceil((hi-lo)/model.totalDepth*280000)),indices=[],samples=[],lookup=new Map(),groups=[];
      const material={totalDepth:model.totalDepth},pointSource=K.prepare(material,0,{notches});
      for(const band of bands){
        const a=Math.max(lo,band.lo),b=Math.min(hi,band.hi);if(b-a<1e-8)continue;
        for(const cell of cells(band,a,b,side,pointSource)){
          const {verts,meta,n,stampSide}=cell;
          const kind=stampSide==='right'?(side==='right'?.10:.20):stampSide==='left'&&side==='left'?.30:0;
          const ids=verts.map(([s,y])=>{
            const k=s+','+y;if(lookup.has(k))return lookup.get(k);
            const i=samples.length;lookup.set(k,i);
            samples.push([s,1-pointSource.edgeInset(side,s,y)/K.WIDTH,y]);return i;
          });
          const uv=meta.map(([x,y])=>kind?atlasUV(n,x,y,rows):[.0001,.0001]);
          const floor=meta.map(([,v,s])=>n?atlasUV(n,.5+(s-n.depth)/(n.span*2.1),v,rows,true):[.0001,.0001]);
          for(const row of [[0,1,2],[0,2,3]]){
            for(const i of row){
              const [,,s,[tint,light]]=meta[i];
              indices.push(ids[i]);batch.push(0,0,0,uv[i][0],uv[i][1],s/model.totalDepth,tint,light,kind,floor[i][0],floor[i][1]);
            }
            groups.push(n?n.group:-1);
          }
        }
      }
      const mesh={data:batch.view(),samples,indices:Int32Array.from(indices),groups:Int16Array.from(groups)};meshes.set(key,mesh);
      if(meshes.size>10)meshes.delete(meshes.keys().next().value);
      return mesh;
    }
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;host.dataset.renderer='depth-context-lost';onContextLoss?.();});
    canvas.addEventListener('webglcontextrestored',()=>{host.dataset.renderer='depth-context-lost';});
    function repaintFonts(){
      for(const tex of pages.values())gl.deleteTexture(tex);pages.clear();dirty=true;
      if(last&&!lost){lastKey='';update(last);}
    }
    doc.fonts?.ready.then(repaintFonts);doc.fonts?.addEventListener('loadingdone',repaintFonts);
    doc.fonts?.load('20px PaperSerif',model.slots.map(s=>s.label).join('')).catch(()=>{});
    function drawLayers({meshesToDraw,sheets,fade,totalSheets,closure,inspection},region){
      gpu.begin(fade,totalSheets,closure,inspection,region);
      for(const mesh of meshesToDraw)gpu.draw(mesh,atlasTexture);
      gpu.draw(body.view(),atlasTexture);
      for(const [index,batch] of sheets)gpu.draw(batch.view(),page(index));
    }
    function update(state){
      if(lost)return false;
      last=state;
      const {material:m,close,shape,packet,printed,digital=0,pick=false,hideInk=false,fineView}=state;
      const left=shape.fanLeft,right=shape.fanRight,inspection=shape.edgeInspection?K.inspectionAmount(close):0;
      const region=rasterRegion(fineView,doc.defaultView.devicePixelRatio||1,limit),regionKey=Object.values(region).join(',');
      const geometry=[m.leftDepth,close,left,right,packet?.s1,packet?.progress,printed?.join(','),pick,digital,hideInk,inspection].join('|');
      const key=geometry+'|'+regionKey;
      if(key===lastKey&&!dirty)return true;
      lastKey=key;const started=performance.now();useRegion(region,regionKey);if(dirty)printAtlas();
      if(geometry===lastGeometry&&lastLayers){
        // Panning across raster tiles does not touch material, glyph layout
        // or hit-test buckets. Only redraw the retained triangles at the new resolution.
        drawLayers(lastLayers,region);host.dataset.depthMs=(performance.now()-started).toFixed(2);return true;
      }
      lastGeometry=geometry;
      const prepared=K.prepare(m,close,shape),T=m.totalDepth,sheets=new Map(),hitTris=[];
      const meshesToDraw=[];body.length=0;for(const batch of pageBatches)batch.length=0;
      function append(points,meta,kind,n,texIndex,stamp=false){
        const batch=texIndex===undefined?body:(sheets.get(texIndex)||pageBatches[sheets.size]);
        if(texIndex!==undefined)sheets.set(texIndex,batch);
        for(let i=0;i<3;i++){
          const p=points[i],[s,y,cut,shade]=meta[i];
          const inked=kind>=3,uv=inked?[s,y]:stamp?atlasUV(n,s,y,rows):[.0001,.0001];
          batch.push(p.x,p.y,p.z,uv[0],uv[1],inked?0:cut/T,inked?0:shade[0],inked?shade:shade[1],kind);
        }
        if(pick)hitTris.push(projectTriangle({points,meta:n?meta:null,n:stamp?n:null}));
      }
      function quad(p,a,kind,n,index,stamp){
        append([p[0],p[1],p[2]],[a[0],a[1],a[2]],kind,n,index,stamp);
        append([p[0],p[2],p[3]],[a[0],a[2],a[3]],kind,n,index,stamp);
      }
      let sections=packet?packet.sections:['left','right'].map(side=>{
        const [lo,hi]=K.layerInterval(side,m);return {side,lo,hi,point:(s,u,y)=>prepared.pagePoint(side,s,u,y)};
      });
      // Identical first and final draw partition, not two coincident faces.
      if(packet?.progress===0||packet?.progress===1){
        const hit=packet.progress===0?packet.s0:packet.s1;
        sections=['left','right'].map(side=>({side,lo:side==='left'?0:hit,hi:side==='left'?hit:T,
          point:(s,u,y)=>packet.resting(side,s,u,y)}));
      }
      const inset=(s,y)=>prepared.edgeInset('right',s,y),outer=(section,s,y)=>section.point(s,1-inset(s,y)/K.WIDTH,y);
      for(const section of sections){
        const {lo,hi,side,point}=section;if(hi-lo<1e-8)continue;
        const sideSign=side==='left'?-1:1;
        const mesh=edgeMesh(lo,hi,side),world=mesh.samples.map(([s,u,y])=>point(s,u,y)),{data,indices}=mesh;
        for(let i=0,j=0;i<indices.length;i++,j+=STRIDE){
          const p=world[indices[i]];data[j]=p.x;data[j+1]=p.y;data[j+2]=p.z;
        }
        if(pick)for(let i=0;i<mesh.groups.length;i++){
          const g=mesh.groups[i],base=i*3*STRIDE,kind=data[base+8],offset=i*3;
          const floor=inspection>.5,stamp=g>=0&&(floor||kind>.05&&(kind<.15||kind<.25&&close>.75||kind>.25&&close<1));
          const row=Math.floor(g/COLUMNS)+(floor?rows:0),vertexV=floor?10:4;
          const atlasV=j=>[0,(data[base+j*STRIDE+vertexV]*2*rows*TILE_H-row*TILE_H-2)/(TILE_H-4)];
          hitTris.push(projectTriangle({points:[world[indices[offset]],world[indices[offset+1]],world[indices[offset+2]]],
            meta:stamp?[atlasV(0),atlasV(1),atlasV(2)]:null,n:stamp?notches[g]:null}));
        }
        meshesToDraw.push(data);
        for(const y of [0,K.HEIGHT])for(let i=0;i<16;i++){
          const a=i/16,b=(i+1)/16;
          const data=[[lo,a],[lo,b],[hi,b],[hi,a]];
          quad(data.map(([s,u])=>point(s,u,y)),data.map(([s,u])=>[0,0,s,[0,.975+.018*u]]),1);
        }
        const cover=sideSign<0?0:T;
        if(!section.moving&&(sideSign<0?lo===0:hi===T)){
          const a=outer(section,cover,0),b=outer(section,cover,K.HEIGHT),dir=sideSign;
          const offset=p=>({...p,x:p.x+.85*dir,y:p.y+.55,z:p.z-.72});
          quad([a,b,offset(b),offset(a)],Array.from({length:4},()=>[0,0,0,[0,1]]),2);
        }
      }
      const leaf=(index,s,section,faceSide)=>{
        const point=section.point,relevant=notches.filter(n=>Math.abs(n.depth-s)<n.span);
        const lastYs=unique([0,K.HEIGHT,...relevant.flatMap(n=>Array.from({length:17},(_,j)=>n.y-n.radius*Math.cos(j*Math.PI/16)))]);
        const uv=(u,y,light)=>[faceSide==='left'?1-u:u,y/K.HEIGHT,0,light];
        for(let i=0;i<32;i++){
          const lo=i/32,hi=(i+1)/32;
          const a=point(s,lo,0),b=point(s,hi,0),dx=b.x-a.x,dz=b.z-a.z;
          const light=.89+.11*Math.abs(dx)/(Math.hypot(dx,dz)||1);
          const ys=hi>.96?lastYs:[0,K.HEIGHT];
          for(let j=0;j<ys.length-1;j++){
            const y0=ys[j],y1=ys[j+1];
            const coords=[[lo,y0],[hi,y0],[hi,y1],[lo,y1]].map(([u,y])=>[Math.min(u,1-inset(s,y)/K.WIDTH),y]);
            quad(coords.map(([u,y])=>point(s,u,y)),coords.map(([u,y])=>uv(u,y,light)),faceSide==='left'?4:3,null,index);
          }
        }
      };
      if(printed){
        if(packet&&packet.progress>0&&packet.progress<1){
          const [l,r,turn]=sections;
          if(packet.dir>0){
            leaf(printed[0],packet.s0,l,'left');
            leaf(printed[3],packet.s1,r,'right');
            leaf(printed[2],packet.s1,turn,'left');
            leaf(printed[1],packet.s0,turn,'right');
          }else{
            leaf(printed[2],packet.s1,l,'left');
            leaf(printed[1],packet.s0,r,'right');
            leaf(printed[3],packet.s1,turn,'right');
            leaf(printed[0],packet.s0,turn,'left');
          }
        }else{
          const final=packet?.progress===1,depth=final?packet.s1:m.leftDepth;
          leaf(printed[final?2:0],depth,sections[0],'left');
          leaf(printed[final?3:1],depth,sections[1],'right');
        }
      }
      const fade=1-clamp(digital/.19,0,1);
      lastLayers={meshesToDraw,sheets,fade:hideInk?0:fade,totalSheets:m.totalSheets,closure:clamp((close-.75)/.25,0,1),inspection};
      drawLayers(lastLayers,region);
      projected=new Map();for(const tri of hitTris){
        const first=Math.floor(tri.bounds[1]/32),last=Math.floor(tri.bounds[3]/32);
        for(let y=first;y<=last;y++){if(!projected.has(y))projected.set(y,[]);projected.get(y).push(tri);}
      }
      targets=pick?model.slots.flatMap(slot=>{
        const n=notches[slot.group],side=slot.anchorDepth+1e-8<m.leftDepth?'left':'right';
        const section=sections.find(s=>s.side===side),stampSide=close>.9999?'right':side;
        const dir=stampSide==='left'?-1:1,j=slot.groupRow,count=n.indices.length;
        const v=.5+(j-(count-1)/2)*(.69/count),y=n.y+n.radius*(2*v-1);
        if(!section||section.hi-section.lo<1e-8)return [];
        return (inspection>.5?[0,.27,-.27]:[.92,.96,.86]).map(q=>{
          const sectionWidth=Math.sqrt(1-(2*v-1)**2);
          const s=clamp(n.depth+n.span*dir*q*sectionWidth,section.lo+1e-8,section.hi-1e-8);
          return {...Solid.project(outer(section,s,y)),n:n.group,index:slot.index,side};
        });
      }):[];
      const triangleCount=(body.length+meshesToDraw.reduce((t,b)=>t+b.length,0)+[...sheets.values()].reduce((s,b)=>s+b.length,0))/(3*STRIDE);
      cost={ms:performance.now()-started,triangles:triangleCount,packetDepth:packet?.span||0};
      host.dataset.rasterTriangles=String(triangleCount);host.dataset.depthMs=cost.ms.toFixed(2);
      return true;
    }
    function hit(x,y,slop,side){
      const at=(x,y)=>frontAt(projected.get(Math.floor(y/32))||[],x,y);
      const direct=at(x,y);
      if(direct?.tri.n){
        const n=direct.tri.n,count=n.indices.length;
        const j=clamp(Math.round((direct.v-.5)*count/.69+(count-1)/2),0,count-1),i=n.indices[j];
        if(targets.some(t=>t.index===i&&(side==='both'||side===t.side)))return i;
      }
      const near=targets.filter(t=>(side==='both'||t.side===side)&&Math.hypot(t.x-x,t.y-y)<=slop)
        .sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
      for(const t of near){const view=at(t.x,t.y);if(view?.tri.n?.group===t.n)return t.index;}
      return null;
    }
    function prepare(indices,packet){
      for(const i of indices)page(i);
      for(const s of packet?.sections||[])if(s.hi-s.lo>1e-8)edgeMesh(s.lo,s.hi,s.side);
    }
    return {update,hit,prepare,getStats:()=>cost,hide:()=>{canvas.hidden=true;},show:()=>{canvas.hidden=false;}};
  }
  return {create,milling,topology,stampUV,projectTriangle,atPixel,frontAt,rasterRegion,atlasRaster,inspectionGlyph};
});
