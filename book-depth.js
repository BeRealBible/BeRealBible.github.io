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
  const COLUMNS=8,TILE_W=128,TILE_H=152,STRIDE=12;
  const labelRow=(n,v)=>clamp(Math.round((v-.5)*n.indices.length/.69+(n.indices.length-1)/2),0,n.indices.length-1);
  // Size the source ink as well as the output buffer. A high-DPR framebuffer
  // cannot restore strokes from a twenty-pixel, four-book stamp.
  function atlasRaster(count,limit=4096){
    const rows=Math.max(1,Math.ceil(count/COLUMNS)),w=COLUMNS*TILE_W,h=2*rows*TILE_H;
    const scale=Math.min(2.25,limit/w,limit/h);
    return {width:Math.floor(w*scale),height:Math.floor(h*scale),scaleX:Math.floor(w*scale)/w,scaleY:Math.floor(h*scale)/h};
  }
  const labelInkEllipse=Object.freeze({rx:.46,ry:.48});
  // Font units live on one paper leaf, never along the stack-depth axis.
  function labelGlyph(n,label){
    const chars=Math.max(1,[...label].length),pitch=n.labelHeight*.69/n.indices.length;
    const size=Math.min(n.labelWidth*.78/n.maxChars,pitch*.82);
    return {size,width:size*chars/n.labelWidth,height:size/n.labelHeight};
  }
  function labelFrame(n,section,inspection=0){
    const c=n.carrierDepth,w=n.labelWidth,h=n.labelHeight;
    const rootU=1-(w+1)/K.WIDTH,H=section.point(c,rootU,n.y-h/2);
    const B=section.point(c,rootU+.001,n.y-h/2);
    const angle=Math.atan2(B.z-H.z,B.x-H.x);
    // The original page margin is flat while fanned. Only its unprinted root
    // folds when inspecting the closed edge. This is a material hinge, not a
    // camera-facing billboard: the fold direction is fixed for this sheet.
    const target=n.foldSign>0?.35:Math.PI-.35;
    let turn=target-angle;while(turn>Math.PI)turn-=2*Math.PI;while(turn< -Math.PI)turn+=2*Math.PI;
    const a=angle+turn*inspection,e={x:Math.cos(a),y:0,z:Math.sin(a)};
    const point=(u,v)=>({x:H.x+e.x*w*u,y:H.y+h*v,z:H.z+e.z*w*u});
    return {carrierDepth:c,width:w,height:h,point,rootU,
      basePoint:(u,v)=>section.point(c,rootU+u*w/K.WIDTH,n.y-h/2+h*v),
      side:section.side,moving:!!section.moving,
      matrix:[e.x,0,e.z,0,0,1,0,0,-e.z,0,e.x,0,H.x,H.y,H.z,1]};
  }
  function labelSection(n,sections){
    const c=n.carrierDepth+1e-8;
    return sections.find(s=>c>=s.lo&&c<s.hi);
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
      const n=g.notch,d=model.totalDepth,carrier=model.slots[g.first];
      const maxChars=Math.max(...g.indices.map(i=>[...model.slots[i].label].length));
      const labelWidth=maxChars>1?20:13;
      const labelRadius=Math.max(n.radius,g.indices.length>=3?g.indices.length*5.6:13);
      const radius=labelRadius*1.2;
      const foldSign=carrier.anchorDepth<d/2?1:-1;
      // Centre the cavity around the actual sheet and its fixed folding space.
      // Only the support interval is clipped by the book ends; never move the
      // carrier to a decorative notch centre or split a label across sheets.
      const span=Math.max(n.span*1.16,labelWidth/3.6*1.3);
      return {...n,depth:carrier.anchorDepth+foldSign*span*.25,span,radius,milled:true,
        inset:labelWidth+6,carrierDepth:carrier.anchorDepth,carrierSheet:carrier.sheet,
        labelWidth,labelHeight:labelRadius*1.84,maxChars,foldSign,
        group:g.index,indices:g.indices,testament:g.testament};
    });
  }
  function topology(total,notches){
    const knots=[-1,-.88,-.65,-.42,0,.42,.65,.88,1];
    const depths=unique([0,total,...Array.from({length:11},(_,i)=>total*i/10),
      ...notches.flatMap(n=>knots.map(q=>clamp(n.depth+n.span*q,0,total)))]);
    return depths.slice(1).map((hi,i)=>{
      const lo=depths[i],active=notches.filter(n=>n.depth+n.span>lo+1e-8&&n.depth-n.span<hi-1e-8);
      const ys=unique([0,K.HEIGHT,...active.flatMap(n=>[
        ...Array.from({length:9},(_,j)=>clamp(n.y-n.radius*Math.cos(Math.PI*j/8),0,K.HEIGHT)),
        // Keep deterministic cuts near the clustered semantic rows.
        ...Array.from({length:Math.max(0,(n.indices?.length||1)-1)},(_,j)=>
          n.y+2*n.radius*(j+1-n.indices.length/2)*.69/n.indices.length)
      ])]);
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
  const VS=`attribute vec3 a_pos;attribute vec2 a_uv;attribute vec4 a_paper;attribute vec2 a_floor;attribute float a_ink;
    uniform vec4 u_region;
    varying vec2 uv;varying vec2 floorUV;varying vec4 paper;varying float visibleInk;
    void main(){
      float w=1.0-a_pos.z/1800.0;
      vec2 pivot=(vec2(480.0,352.0)-u_region.xy)/u_region.zw;
      vec2 clip=2.0*(a_pos.xy-vec2(480.0,352.0))/u_region.zw+(2.0*pivot-1.0)*w;
      gl_Position=vec4(clip.x,-clip.y,-a_pos.z/1100.0,w);
      uv=a_uv;floorUV=a_floor;paper=a_paper;visibleInk=a_ink;
    }`;
  const FS=`#extension GL_OES_standard_derivatives : enable
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec2 uv;varying vec2 floorUV;varying vec4 paper;varying float visibleInk;
    uniform sampler2D u_tex;uniform float u_stamp;uniform float u_sheets;uniform float u_closed;uniform float u_inspect;
    void main(){
      if(paper.w>5.5){gl_FragColor=vec4(vec3(.991,.955,.884)*paper.z,1.0);return;}
      if(paper.w>4.5){
        vec4 ink=texture2D(u_tex,gl_FrontFacing?floorUV:uv);
        vec3 stock=vec3(.991,.955,.884)*paper.z;
        gl_FragColor=vec4(mix(stock,ink.rgb,u_stamp*ink.a),1.0);return;
      }
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
      // Stack walls contain fibres only. No label UV, floor stamp, or
      // per-book opacity can turn this multi-sheet mesh into printed paper.
      float cavity=smoothstep(.0,.91,paper.y);
      vec3 recess=mix(tinted,fibre*(1.0-.18*cavity),smoothstep(.035,.47,paper.y));
      recess*=.99+irregular-line*.14-grain*.052;
      gl_FragColor=vec4(mix(stock,recess,u_inspect),1.0);
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
    [['a_pos',3,0],['a_uv',2,3],['a_paper',4,5],['a_floor',2,9],['a_ink',1,11]].forEach(([name,size,offset])=>{
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
    push(x,y,z,u,v,s,ink,light,kind,fu=.0001,fv=.0001,visibleInk=1){
      let i=this.length;
      if(i+STRIDE>this.data.length){const next=new Float32Array(this.data.length*2);next.set(this.data);this.data=next;}
      const d=this.data;d[i++]=x;d[i++]=y;d[i++]=z;d[i++]=u;d[i++]=v;
      d[i++]=s;d[i++]=ink;d[i++]=light;d[i++]=kind;d[i++]=fu;d[i++]=fv;d[i++]=visibleInk;this.length=i;
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
    let atlasTexture=null,dirty=true,pages=new Map(),last=null,lastKey='',lastGeometry='',lastLayers=null,projected=new Map(),targets=[],labelFrames=new Map(),cost={};
    const body=new Batch(4096),pageBatches=Array.from({length:4},()=>new Batch(4096)),meshes=new Map();
    const atlasPaint=atlas.getContext('2d');
    function printAtlas(){
      atlasPaint.clearRect(0,0,atlas.width,atlas.height);
      atlasPaint.save();atlasPaint.scale(inkRaster.scaleX,inkRaster.scaleY);
      for(const n of notches){
        const x=n.group%COLUMNS*TILE_W+2,y=Math.floor(n.group/COLUMNS)*TILE_H+2;
        const w=TILE_W-4,h=TILE_H-4;
        atlasPaint.save();atlasPaint.translate(x,y);
        // Work in real leaf units: the source is supersampled, not stretched.
        atlasPaint.scale(w/n.labelWidth,h/n.labelHeight);
        const lw=n.labelWidth,lh=n.labelHeight;
        atlasPaint.beginPath();atlasPaint.ellipse(lw*.5,lh*.5,lw*labelInkEllipse.rx,lh*labelInkEllipse.ry,0,0,2*Math.PI);
        atlasPaint.fillStyle=n.testament==='new'?'#932d31':'#282c27';atlasPaint.fill();atlasPaint.clip();
        atlasPaint.textAlign='center';atlasPaint.textBaseline='middle';
        n.indices.forEach((i,j)=>{
          const slot=model.slots[i],yy=lh*(.5+(j-(n.indices.length-1)/2)*.69/n.indices.length);
          const glyph=labelGlyph(n,slot.label);
          atlasPaint.fillStyle='#fff0bc';
          atlasPaint.font=`600 ${glyph.size}px PaperSerif,"Microsoft YaHei",serif`;
          atlasPaint.fillText(slot.label,lw*.5,yy);
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
        const verts=[[a,y0],[b,y0],[b,y1],[a,y1]];
        const meta=verts.map(([s,y])=>{
          const cut=n?pointSource.edgeInset(side,s,y):0;
          const c=n?tone(n,s,y):0,tint=n?clamp(cut/(n.inset*.74),0,1):0;
          return [0,0,s,[tint,1-.12*tint+.025*c]];
        });
        const stampSide=null;
        result.push({verts,meta,n,stampSide});
      }
      return result;
    }
    function edgeMesh(lo,hi,side){
      const key=[lo,hi,side].join(',');
      if(meshes.has(key)){const hit=meshes.get(key);meshes.delete(key);meshes.set(key,hit);return hit;}
      const batch=new Batch(24000+Math.ceil((hi-lo)/model.totalDepth*280000)),indices=[],samples=[],lookup=new Map(),groups=[],labels=[];
      const material={totalDepth:model.totalDepth},pointSource=K.prepare(material,0,{notches});
      for(const band of bands){
        const a=Math.max(lo,band.lo),b=Math.min(hi,band.hi);if(b-a<1e-8)continue;
        for(const cell of cells(band,a,b,side,pointSource)){
          const {verts,meta,n,stampSide}=cell;
          const kind=0;
          const ids=verts.map(([s,y])=>{
            const k=s+','+y;if(lookup.has(k))return lookup.get(k);
            const i=samples.length;lookup.set(k,i);
            samples.push([s,1-pointSource.edgeInset(side,s,y)/K.WIDTH,y]);return i;
          });
          const uv=meta.map(()=>[.0001,.0001]);
          const floor=meta.map(()=>[.0001,.0001]);
          for(const row of [[0,1,2],[0,2,3]]){
            for(const i of row){
              const [,,s,[tint,light]]=meta[i];
              indices.push(ids[i]);batch.push(0,0,0,uv[i][0],uv[i][1],s/model.totalDepth,tint,light,kind,floor[i][0],floor[i][1]);
            }
            groups.push(n?n.group:-1);
            labels.push(n?n.indices[labelRow(n,((verts[0][1]+verts[2][1])/2-n.y)/(2*n.radius)+.5)]:-1);
          }
        }
      }
      const mesh={data:batch.view(),samples,indices:Int32Array.from(indices),groups:Int16Array.from(groups),labels:Int16Array.from(labels)};meshes.set(key,mesh);
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
          data[j+11]=0;
        }
        if(pick)for(let i=0;i<mesh.groups.length;i++){
          const offset=i*3;
          hitTris.push(projectTriangle({points:[world[indices[offset]],world[indices[offset+1]],world[indices[offset+2]]],n:null,book:-1}));
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
      labelFrames=new Map();
      for(const n of notches){
        const section=labelSection(n,sections);if(!section)continue;
        const frame=labelFrame(n,section,inspection);labelFrames.set(n.group,frame);
        const vs=unique([0,.3,.7,1,...Array.from({length:17},(_,j)=>j/16),
          ...Array.from({length:n.indices.length-1},(_,j)=>.5+(j+1-n.indices.length/2)*.69/n.indices.length)]);
        // An unprinted neck joins the retained page to the ellipse. Its
        // inner edge follows the ACTUAL combined cut, not a fixed offset.
        // Stop at the ellipse boundary: no coincident overlay can steal hits.
        const paperQuad=coords=>{
          for(const ids of [[0,1,2],[0,2,3]]){
            const points=ids.map(i=>coords[i]);
            for(const p of points)body.push(p.x,p.y,p.z,.0001,.0001,n.carrierDepth/T,0,1,6,.0001,.0001,0);
            if(pick)hitTris.push(projectTriangle({points,n:null,book:-1}));
          }
        };
        const leftEdge=v=>.5-.5*Math.sqrt(Math.max(0,1-(2*v-1)**2));
        const neckRows=vs.filter(v=>v>=.3&&v<=.7);
        for(let j=0;j<neckRows.length-1;j++){
          const a=neckRows[j],b=neckRows[j+1];
          const inner=v=>{
            const y=n.y+(v-.5)*frame.height;
            const u=Math.min(frame.rootU-2/K.WIDTH,1-(inset(n.carrierDepth,y)+1)/K.WIDTH);
            return section.point(n.carrierDepth,u,y);
          };
          paperQuad([inner(a),frame.point(0,a),frame.point(0,b),inner(b)]);
          paperQuad([frame.point(0,a),frame.point(leftEdge(a),a),frame.point(leftEdge(b),b),frame.point(0,b)]);
        }
        // Curved outline, planar substrate: all vertices below have the SAME
        // material s. Subdivide at row boundaries only for unambiguous hits.
        for(let j=0;j<vs.length-1;j++){
          const v0=vs[j],v1=vs[j+1];
          const half=v=>.5*Math.sqrt(Math.max(0,1-(2*v-1)**2));
          const coords=[[.5-half(v0),v0],[.5+half(v0),v0],[.5+half(v1),v1],[.5-half(v1),v1]];
          const book=n.indices[labelRow(n,(v0+v1)/2)];
          for(const ids of [[0,1,2],[0,2,3]]){
            const points=ids.map(i=>frame.point(...coords[i]));
            for(let k=0;k<3;k++){
              const [u,v]=coords[ids[k]],p=points[k],uv=atlasUV(n,u,v,rows);
              const backUV=atlasUV(n,1-u,v,rows);
              body.push(p.x,p.y,p.z,...uv,n.carrierDepth/T,0,1,5,...backUV,1);
            }
            if(pick)hitTris.push(projectTriangle({points,meta:ids.map(i=>coords[i]),n,book}));
          }
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
        const n=notches[slot.group],f=labelFrames.get(slot.group);if(!f)return [];
        const v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
        return [.5,.35,.65].map(u=>({...Solid.project(f.point(u,v)),n:n.group,index:slot.index,side:f.side}));
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
        const i=direct.tri.book;
        if(targets.some(t=>t.index===i&&(side==='both'||side===t.side)))return i;
      }
      const near=targets.filter(t=>(side==='both'||t.side===side)&&Math.hypot(t.x-x,t.y-y)<=slop)
        .sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y));
      for(const t of near){const view=at(t.x,t.y);if(view?.tri.n?.group===t.n&&view.tri.book===t.index)return t.index;}
      return null;
    }
    function prepare(indices,packet){
      for(const i of indices)page(i);
      for(const s of packet?.sections||[])if(s.hi-s.lo>1e-8)edgeMesh(s.lo,s.hi,s.side);
    }
    function getLabelFrame(index){
      const slot=model.slots[index];if(!slot)return null;
      const n=notches[slot.group],f=labelFrames.get(slot.group);if(!f)return null;
      const a=slot.physical,v=.5+(slot.groupRow-(n.indices.length-1)/2)*.69/n.indices.length;
      const p=f.point(0,v-a.height/(2*f.height)),matrix=f.matrix.slice();
      matrix[0]*=f.width/a.width;matrix[2]*=f.width/a.width;
      matrix[12]=p.x;matrix[13]=p.y;matrix[14]=p.z;
      return {...f,matrix};
    }
    return {update,hit,prepare,getLabelFrame,getStats:()=>cost,hide:()=>{canvas.hidden=true;},show:()=>{canvas.hidden=false;}};
  }
  return {create,milling,topology,projectTriangle,atPixel,frontAt,rasterRegion,atlasRaster,labelInkEllipse,labelGlyph,labelFrame,labelSection,labelRow};
});
