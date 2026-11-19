(function(root){
  'use strict';
  const P=root.PaperPhysics,W=1080,H=990,LEFT=60,TOP=240;
  const originWeight=progress=>{const t=Math.max(0,Math.min(1,(Number(progress)||0)/.52));return 1-t*t*(3-2*t);};
  function projectBoundPoint(point){
    const perspective=1800,ratio=perspective/(perspective-point.z);
    return {x:480+(point.x-480)*ratio,y:352+(point.y-352)*ratio,z:point.z};
  }
  function originProfile(surface,cols,rows){
    const K=root.PaperBookKinematics;if(!surface||!K)return null;
    const side=surface.side==='left'?'left':'right',direction=side==='left'?-1:1;
    const material=surface.material||{},state=surface.state||{},depth=K.frame(material,0).leftDepth;
    const cutDepth=side==='left'&&material.totalSheets?Math.max(0,depth-material.totalDepth/material.totalSheets):depth;
    const vertices=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
      const row=j/rows*704,u=i/cols,inset=K.edgeInset(side,cutDepth,row,material,state);
      const s=Math.min(u*480,480-inset),flatX=480+direction*s;
      const point=K.pagePoint(side,depth,s/480,row,material,surface.close||0,state),projected=projectBoundPoint(point);
      vertices.push({s,cut:s<u*480-1e-8,dx:projected.x-flatX,
        dy:projected.y-row+point.z*P.SLOPE,dz:point.z});
    }
    return {vertices,cols,rows,direction};
  }
  function applyOriginSurface(shape,options,direction,profile){
    if(!options.originSurface)return shape;
    const origin=profile||originProfile(options.originSurface,shape.cols,shape.rows);if(!origin)return shape;
    const a=shape.vertices,weight=originWeight(options.progress),stride=shape.cols+1;
    for(let i=0;i<origin.vertices.length;i++){
      const at=i*8,entry=origin.vertices[i];
      // Only the unprinted outer margin is cut away. Body glyph UVs and all
      // ordinary (non-index) curls are unchanged.
      if(entry.cut){const point=P.point({...options,direction},entry.s,a[at+4]*704);a[at]=point.x;a[at+1]=point.y;a[at+2]=point.z;}
      a[at]+=entry.dx*weight;a[at+1]+=entry.dy*weight;a[at+2]+=entry.dz*weight;
    }
    // Recompute normals from the deformed ruled surface for both WebGL and
    // Canvas shading. Direction keeps the front side consistent on the left.
    let maxZ=0;
    for(let j=0;j<=shape.rows;j++)for(let i=0;i<=shape.cols;i++){
      const k=(j*stride+i)*8,l=(j*stride+Math.max(0,i-1))*8,r=(j*stride+Math.min(shape.cols,i+1))*8;
      const t=(Math.max(0,j-1)*stride+i)*8,b=(Math.min(shape.rows,j+1)*stride+i)*8;
      const ux=a[r]-a[l],uy=a[r+1]-a[l+1],uz=a[r+2]-a[l+2];
      const vx=a[b]-a[t],vy=a[b+1]-a[t+1],vz=a[b+2]-a[t+2];
      const nx=(uy*vz-uz*vy)*direction,ny=(uz*vx-ux*vz)*direction,nz=(ux*vy-uy*vx)*direction;
      const len=Math.hypot(nx,ny,nz)||1;a[k+5]=nx/len;a[k+6]=ny/len;a[k+7]=nz/len;maxZ=Math.max(maxZ,a[k+2]);
    }
    shape.maxZ=maxZ;return shape;
  }
  const VS=`attribute vec3 a_position;attribute vec2 a_uv;attribute vec3 a_normal;
    uniform float u_layer;varying vec2 v_uv;varying vec3 v_normal;
    void main(){vec3 p=a_position;p.z+=u_layer; p.y+=u_layer*.22;
      gl_Position=vec4((p.x+60.0)/1080.0*2.0-1.0,1.0-(p.y-p.z*.24+240.0)/990.0*2.0,-p.z/900.0,1.0);
      v_uv=a_uv;v_normal=a_normal;}`;
  const FS=`precision mediump float;varying vec2 v_uv;varying vec3 v_normal;
    uniform sampler2D u_front;uniform sampler2D u_back;uniform float u_direction;uniform float u_packet;
    void main(){bool front=gl_FrontFacing;float x=u_direction>0.0?v_uv.x:1.0-v_uv.x;
      vec4 paper=front?texture2D(u_front,vec2(x,v_uv.y)):texture2D(u_back,vec2(1.0-x,v_uv.y));
      vec3 n=normalize(v_normal)*(front?1.0:-1.0);float light=max(dot(n,normalize(vec3(-.3,-.32,1.0))),0.0);
      float bend=pow(1.0-abs(n.z),2.0);float shade=.83+.17*light-.045*bend;
      if(u_packet>0.5)paper=vec4(.92,.88,.78,1.0);
      if(min(v_uv.x,1.0-v_uv.x)<.0015||min(v_uv.y,1.0-v_uv.y)<.0012)paper.rgb=mix(paper.rgb,vec3(.97,.94,.86),.65);
      gl_FragColor=vec4(paper.rgb*shade,paper.a);}`;
  function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  class Renderer{
    constructor(host,painter){
      this.host=host;this.painter=painter;this.cache=new Map();this.cols=40;this.rows=16;
      this.shadow=document.createElement('canvas');this.shadow.className='paper-curl-shadow';
      this.canvas=document.createElement('canvas');this.canvas.className='paper-curl-canvas';
      for(const c of [this.shadow,this.canvas]){c.setAttribute('aria-hidden','true');host.appendChild(c);}
      this.shadow.width=W;this.shadow.height=H;this.shadowContext=this.shadow.getContext('2d');
      this.pixelRatio=Math.min(root.devicePixelRatio||1,1.75);
      this.canvas.width=Math.round(W*this.pixelRatio);this.canvas.height=Math.round(H*this.pixelRatio);
      let gl;
      try{gl=new URLSearchParams(location.search).get('paperRenderer')==='canvas'?null:this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});if(gl)this.initGL(gl);}catch(e){console.warn('纸页 GPU 不可用，使用曲面 Canvas 回退。',e.message);gl=null;}
      if(!gl){this.canvas.remove();this.canvas=document.createElement('canvas');this.canvas.className='paper-curl-canvas';this.canvas.width=W;this.canvas.height=H;this.canvas.setAttribute('aria-hidden','true');host.appendChild(this.canvas);this.fallback=this.canvas.getContext('2d');this.cols=20;this.rows=8;}
      this.gl=gl;host.dataset.renderer=gl?'webgl-curved-sheet':'canvas-curved-sheet';
      this.triangles=P.indices(this.cols,this.rows);
      if(gl){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,this.triangles,gl.STATIC_DRAW);}
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(this.onContextLoss)this.onContextLoss();});
      this.hide();
      // A newly opened book may load another local font subset. Never keep
      // fallback-font page textures after that subset becomes available.
      const refreshFonts=()=>{
        this.cache.clear();
        if(this.canvas.hidden||!this.pageIndices)return;
        const shape=this.lastOptions;
        this.prepare(...this.pageIndices,this.direction,this.count);
        if(shape)this.draw(shape);
      };
      document.fonts?.ready.then(refreshFonts);
      document.fonts?.addEventListener?.('loadingdone',refreshFonts);
    }
    initGL(gl){
      const program=gl.createProgram();gl.attachShader(program,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(program,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
      this.program=program;gl.useProgram(program);this.buffer=gl.createBuffer();this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      [['a_position',3,0],['a_uv',2,12],['a_normal',3,20]].forEach(([name,size,offset])=>{const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,32,offset);});
      this.uniforms={};['u_front','u_back','u_direction','u_layer','u_packet'].forEach(n=>this.uniforms[n]=gl.getUniformLocation(program,n));
      this.textures=[gl.createTexture(),gl.createTexture()];
      gl.uniform1i(this.uniforms.u_front,0);gl.uniform1i(this.uniforms.u_back,1);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
    }
    page(index){
      if(this.cache.has(index))return this.cache.get(index);
      const c=document.createElement('canvas'),ratio=2;c.width=480*ratio;c.height=704*ratio;
      this.painter(c,index,ratio);this.cache.set(index,c);
      if(this.cache.size>6)this.cache.delete(this.cache.keys().next().value);
      return c;
    }
    prepare(front,back,direction,count=1){
      this.originSurface=null;this.originProfile=null;
      this.pageIndices=[front,back];this.direction=direction;this.count=count;this.images=[this.page(front),this.page(back)];
      const gl=this.gl;
      if(gl){gl.useProgram(this.program);this.images.forEach((image,i)=>{
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,this.textures[i]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      });gl.frontFace(direction>0?gl.CW:gl.CCW);gl.uniform1f(this.uniforms.u_direction,direction);}
      this.canvas.hidden=false;this.shadow.hidden=false;
    }
    draw(options){
      this.lastOptions={...options};
      const shape=P.mesh({...options,direction:this.direction},this.cols,this.rows);this.lastShape=shape;
      if(options.originSurface){
        if(this.originSurface!==options.originSurface){this.originSurface=options.originSurface;this.originProfile=originProfile(options.originSurface,this.cols,this.rows);}
        applyOriginSurface(shape,options,this.direction,this.originProfile);
      }
      this.drawShadow(shape,options.progress);
      if(this.gl){
        const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,shape.vertices,gl.DYNAMIC_DRAW);
        gl.uniform1f(this.uniforms.u_packet,1);
        const layers=Math.min(4,this.count-1);
        for(let i=layers;i>=1;i--){gl.uniform1f(this.uniforms.u_layer,-i*1.7);gl.drawElements(gl.TRIANGLES,this.triangles.length,gl.UNSIGNED_SHORT,0);}
        gl.uniform1f(this.uniforms.u_packet,0);gl.uniform1f(this.uniforms.u_layer,0);gl.drawElements(gl.TRIANGLES,this.triangles.length,gl.UNSIGNED_SHORT,0);
      }else this.drawFallback(shape);
      this.host.dataset.curlProgress=options.progress.toFixed(4);this.host.dataset.curlHeight=shape.maxZ.toFixed(2);
    }
    drawShadow(shape,p){
      const ctx=this.shadowContext,a=shape.vertices,c=shape.cols,r=shape.rows;
      ctx.clearRect(0,0,W,H);if(p<=0||p>=1)return;
      const outline=[];
      for(let i=0;i<=c;i++)outline.push(i);
      for(let j=1;j<=r;j++)outline.push(j*(c+1)+c);
      for(let i=c-1;i>=0;i--)outline.push(r*(c+1)+i);
      for(let j=r-1;j>0;j--)outline.push(j*(c+1));
      ctx.save();ctx.translate(LEFT,TOP);ctx.beginPath();
      outline.forEach((i,n)=>{const k=i*8,px=a[k]+a[k+2]*.17,py=a[k+1]+a[k+2]*.09;n?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.closePath();
      const alpha=.1+Math.sin(Math.PI*p)*.12;ctx.fillStyle=`rgba(43,34,19,${alpha})`;
      ctx.shadowColor=`rgba(39,29,15,${alpha+.05})`;ctx.shadowBlur=8+Math.min(26,shape.maxZ*.1);ctx.shadowOffsetY=5;ctx.fill();ctx.restore();
    }
    drawFallback(shape){
      const ctx=this.fallback,a=shape.vertices,idx=this.triangles;ctx.clearRect(0,0,W,H);
      const tris=[];
      for(let k=0;k<idx.length;k+=3){const ids=[idx[k],idx[k+1],idx[k+2]];tris.push({ids,z:ids.reduce((s,i)=>s+a[i*8+2],0)/3});}
      tris.sort((a,b)=>a.z-b.z);
      for(const {ids} of tris){
        const pts=ids.map(i=>{const k=i*8;return {x:a[k]+LEFT,y:a[k+1]-a[k+2]*P.SLOPE+TOP,u:a[k+3],v:a[k+4],n:a[k+7]};});
        const front=pts.reduce((s,p)=>s+p.n,0)>=0,image=this.images[front?0:1];
        const from=pts.map(p=>({x:((this.direction>0)===front?p.u:1-p.u)*image.width,y:p.v*image.height}));
        this.triangle(ctx,image,from,pts);
      }
    }
    triangle(ctx,image,s,d){
      const [p,q,r]=s,[a,b,c]=d,det=p.x*(q.y-r.y)+q.x*(r.y-p.y)+r.x*(p.y-q.y);if(Math.abs(det)<.001)return;
      const coeff=(v1,v2,v3)=>[(v1*(q.y-r.y)+v2*(r.y-p.y)+v3*(p.y-q.y))/det,(v1*(r.x-q.x)+v2*(p.x-r.x)+v3*(q.x-p.x))/det,(v1*(q.x*r.y-r.x*q.y)+v2*(r.x*p.y-p.x*r.y)+v3*(p.x*q.y-q.x*p.y))/det];
      const xx=coeff(a.x,b.x,c.x),yy=coeff(a.y,b.y,c.y);
      const cx=(a.x+b.x+c.x)/3,cy=(a.y+b.y+c.y)/3;
      const expand=p=>{const d=Math.hypot(p.x-cx,p.y-cy)||1;return {x:p.x+(p.x-cx)/d*.28,y:p.y+(p.y-cy)/d*.28};};
      const [aa,bb,cc]=[a,b,c].map(expand);
      ctx.save();ctx.beginPath();ctx.moveTo(aa.x,aa.y);ctx.lineTo(bb.x,bb.y);ctx.lineTo(cc.x,cc.y);ctx.closePath();ctx.clip();ctx.transform(xx[0],yy[0],xx[1],yy[1],xx[2],yy[2]);ctx.drawImage(image,0,0);
      ctx.fillStyle=`rgba(41,34,22,${.035+.12*(1-Math.abs((a.n+b.n+c.n)/3))})`;ctx.fillRect(0,0,image.width,image.height);ctx.restore();
    }
    hide(){this.canvas.hidden=true;this.shadow.hidden=true;delete this.host.dataset.curlProgress;delete this.host.dataset.curlHeight;}
  }
  // The flat reader may be zoomed until a page is several phone screens wide.
  // Rendering its turning ink in a separate transparent GPU surface can expose
  // newly swapped DOM ink before the mobile compositor presents the texture.
  // Use the same SVG surface for the opaque sheet, its shadow and real glyphs.
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),round=x=>Math.round(x*1000)/1000;
  function knots(length,count,contact){
    const a=Array.from({length:count+1},(_,i)=>length*i/count);
    if(contact>1e-6&&contact<length-1e-6)a[clamp(Math.round(contact*count/length),1,count-1)]=contact;
    return a;
  }
  // Keep the grabbed material point exactly on the pointer. A stiff bound
  // leaf can peel briefly at the corner, but then its rows turn together.
  // Releasing the lag smoothly avoids a twisted, accordion-like silhouette.
  const smoothstep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  function surface(options,cols=6,rows=4){
    const dir=options.direction<0?-1:1,p=clamp(options.progress,0,1);
    const radius=clamp(options.radius??392,12,480),gy=clamp(options.grabY??600,0,704);
    const top=options.corner?options.corner==='top':gy<352,vertical=p===0||p===1?0:clamp(options.vertical||0,-210,210);
    // The older roll used one profile across the entire height of the sheet.
    // No corner lag or vertical twist: corresponding points stay 704px apart.
    if(options.smooth){cols=14;rows=1;}
    const us=knots(480,cols,radius),vs=options.smooth?[0,704]:knots(704,rows,gy),triangles=[],points=[];
    const profile=options.smooth?us.map(u=>P.point({direction:dir,radius,grabY:0,progress:p,vertical:0},u,0)):null;
    for(const v of vs){
      if(profile){
        for(const [i,q] of profile.entries())points.push({u:us[i],v,x:q.x,y:v+q.y-P.SLOPE*q.z,z:q.z});
        continue;
      }
      const from=(top?1:-1)*(v-gy)/704;
      const delay=.23*Math.max(0,from)*(1-smoothstep((p-.12)/.48));
      const progress=from>0?Math.max(0,(p-delay)/(1-delay)):p+.20*(-from)*p*(1-p);
      const follow=p>0?Math.min(1,progress/p):0;
      const row={direction:dir,radius,grabY:v,progress,vertical:vertical*follow*Math.max(0,1-Math.abs(from)*1.55)};
      for(const u of us){
        const q=P.point(row,u,v);points.push({u,v,x:q.x,y:q.y-P.SLOPE*q.z,z:q.z});
      }
    }
    function face(a,b,c,tile){
      const ax=b.u-a.u,ay=b.v-a.v,bx=c.u-a.u,by=c.v-a.v,det=ax*by-ay*bx;
      const project=k=>{const q=b[k]-a[k],r=c[k]-a[k],u=(by*q-ay*r)/det,v=(ax*r-bx*q)/det;return [u,v,a[k]-a.u*u-a.v*v];};
      const [xx,xy,x]=project('x'),[yx,yy,y]=project('y'),area=xx*yy-yx*xy;
      return {a,b,c,tile,m:[xx,yx,xy,yy,x,y],front:dir*area>=0,winding:area>=0,z:(a.z+b.z+c.z)/3,shade:.15*(1-Math.min(1,Math.abs(area)))};
    }
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1,t=j*cols+i;
      triangles.push(face(points[a],points[b],points[c],t),face(points[b],points[d],points[c],t));
    }
    return {triangles,points,us,vs,cols,rows,dir};
  }
  // At every projected vertex ordinate, find the furthest paper ink on the
  // source side. Between consecutive ordinates triangle edges are straight:
  // interpolating the maximum of their endpoints conservatively covers them
  // all, including a curled-over returning face. Never unmask next-page ink
  // just because the moving corner on another row has cleared it.
  function maskFor(s){
    const ys=[...new Set([0,704,...s.points.map(q=>clamp(q.y,0,704))])].sort((a,b)=>a-b),edges=[];
    for(const {a,b,c} of s.triangles)edges.push([a,b],[b,c],[c,a]);
    const boundary=ys.map(y=>{
      let u=0;
      for(const [a,b] of edges){
        if(y<Math.min(a.y,b.y)-1e-8||y>Math.max(a.y,b.y)+1e-8)continue;
        if(Math.abs(a.y-b.y)<1e-8)u=Math.max(u,(a.x-480)*s.dir,(b.x-480)*s.dir);
        else u=Math.max(u,(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y)-480)*s.dir);
      }
      u=clamp(u,0,480);return {x:s.dir>0?u:480-u,y};
    });
    const outer=s.dir>0?480:0;
    const css='polygon('+[...boundary,{x:outer,y:704},{x:outer,y:0}].map(q=>round(q.x)+'px '+round(q.y)+'px').join(',')+')';
    return {boundary,css};
  }
  // Keep private gradient IDs, and split only the known generated SVG ink by
  // its authored page coordinates. Unrecognised or long runs are never culled
  // horizontally. The real SVG clip, not an estimated text width, cuts edges.
  function splitInk(markup){
    const glyphs=[];
    const stock=markup.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g,el=>{
      const tag=el.slice(0,el.indexOf('>')+1),num=k=>{const m=tag.match(new RegExp(' '+k+'="([^"]+)"'));return m?Number(m[1]):NaN;};
      const x=num('x'),y=num('y'),size=num('font-size'),single=el.slice(tag.length,-7).replace(/&[^;]+;/g,'?');
      // Exact physical words are matrix-transformed: their raw font size and
      // baseline are not book-space coordinates. Clone only intersecting words
      // when falling back to a fully vector curl without WebGL/Canvas ink.
      const physical=tag.match(/ data-clip="(-?\d+) (-?\d+) (-?\d+) (-?\d+)"/);
      if(physical){const [l,r,t,b]=physical.slice(1).map(Number);glyphs.push({el,l,r,t,b});return '';}
      const finite=Number.isFinite(x+y+size)&&size>0,small=finite&&[...single].length===1;
      glyphs.push({el,l:small?x-3*size:-Infinity,r:small?x+3*size:Infinity,t:finite?y-3*size:-Infinity,b:finite?y+3*size:Infinity});return '';
    });
    return {stock,glyphs};
  }
  // The stationary page is still rendered as text in its original SVG. During
  // a gesture, cache each face just once at display density and map its ink
  // across the moving mesh in one draw, rather than repainting thousands of
  // CJK glyphs through 48 SVG clips on every pointer update.
  function movingInk(host,painter){
    if(typeof painter!=='function')return null;
    const doc=host.ownerDocument,cache=new Map(),out=doc.createElement('canvas');
    const style='position:absolute;z-index:8;pointer-events:none;display:block;';
    out.setAttribute('aria-hidden','true');out.className='paper-turn-ink';
    let canvas=out,gl,ctx,resource,images,view,ratio;
    try{
      gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:false,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
      if(gl){
        const pg=gl.createProgram(),vs='attribute vec2 a_xy; attribute vec2 a_uv; attribute vec2 a_tone; uniform vec4 u_view; varying vec2 uv; varying vec2 tone; void main(){vec2 p=(a_xy-u_view.xy)/u_view.zw; gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);uv=a_uv;tone=a_tone;}';
        const fs='precision mediump float; varying vec2 uv; varying vec2 tone; uniform sampler2D page0; uniform sampler2D page1; void main(){vec3 ink=tone.x<.5?texture2D(page0,uv).rgb:texture2D(page1,uv).rgb;gl_FragColor=vec4(mix(ink,vec3(.22,.15,.06),tone.y),1.);}';
        gl.attachShader(pg,shader(gl,gl.VERTEX_SHADER,vs));gl.attachShader(pg,shader(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(pg);
        if(!gl.getProgramParameter(pg,gl.LINK_STATUS))throw Error('page mesh shader unavailable');
        gl.useProgram(pg);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        ['a_xy','a_uv','a_tone'].forEach((name,i)=>{const loc=gl.getAttribLocation(pg,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,24,i*8);});
        const textures=[0,1].map(i=>{const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tex);
          for(const [param,val] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,param,val);
          gl.uniform1i(gl.getUniformLocation(pg,'page'+i),i);return tex;});
        resource={view:gl.getUniformLocation(pg,'u_view'),buffer,textures};gl.clearColor(0,0,0,0);
      }
    }catch{gl=null;}
    function fallback(){
      gl=null;if(canvas===out&&resource){canvas=doc.createElement('canvas');canvas.className=out.className;canvas.setAttribute('aria-hidden','true');out.remove();}
      ctx=canvas.getContext('2d',{alpha:true});if(!ctx&&canvas===out){canvas=doc.createElement('canvas');canvas.className=out.className;canvas.setAttribute('aria-hidden','true');ctx=canvas.getContext('2d');}
    }
    if(!gl)fallback();
    if(!gl&&!ctx)return null;
    const invalidate=()=>cache.clear();doc.fonts?.addEventListener?.('loadingdone',invalidate);
    function texture(index,r){
      const key=index+':'+r;if(cache.has(key)){const c=cache.get(key);cache.delete(key);cache.set(key,c);return c;}
      const c=doc.createElement('canvas');c.width=Math.round(480*r);c.height=Math.round(704*r);
      painter(c,index,r);cache.set(key,c);while(cache.size>4)cache.delete(cache.keys().next().value);
      return c;
    }
    function prepare(front,back,light=false){
      const r=host.getBoundingClientRect(),scale=r.width/960||1,dpr=root.devicePixelRatio||1,vp=doc.documentElement;
      const x0=clamp(Math.floor(-r.left/scale)-8,-8,958),x1=clamp(Math.ceil((vp.clientWidth-r.left)/scale)+8,x0+2,968);
      const y0=clamp(Math.floor(-r.top/scale)-8,-220,922),y1=clamp(Math.ceil((vp.clientHeight-r.top)/scale)+8,y0+2,924);
      view={x:x0,y:y0,w:x1-x0,h:y1-y0};
      ratio=Math.max(.25,Math.min(3,scale*dpr,Math.sqrt((light?1100000:3500000)/(view.w*view.h))));
      const tr=clamp(Math.ceil(scale*dpr*2)/2,1,light?1.5:2.5);images=[texture(front,tr),texture(back,tr)];
      if(gl?.isContextLost())fallback();
      // On context loss recover immediately to a separate 2D canvas (a canvas
      // with an allocated WebGL context cannot acquire another context type).
      if(gl)for(let i=0;i<2;i++){
        gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,resource.textures[i]);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,images[i]);
      }
      const w=Math.round(view.w*ratio),h=Math.round(view.h*ratio);
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
      canvas.style.cssText=style+'left:'+x0+'px;top:'+y0+'px;width:'+view.w+'px;height:'+view.h+'px;';
      host.appendChild(canvas);host.dataset.turnInk=gl?'webgl':'canvas';
    }
    function draw(s,order,arc){
      if(gl?.isContextLost()){fallback();return false;}
      if(gl){
        const arr=new Float32Array(order.length*18);let n=0;
        for(const i of order){const t=s.triangles[i],side=t.front?0:1,mirror=(s.dir<0)!==(side===1);
          for(const q of [t.a,t.b,t.c]){arr[n++]=q.x;arr[n++]=q.y;arr[n++]=(mirror?480-q.u:q.u)/480;arr[n++]=q.v/704;arr[n++]=side;arr[n++]=arc*t.shade;}}
        gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform4f(resource.view,view.x,view.y,view.w,view.h);
        gl.bufferData(gl.ARRAY_BUFFER,arr,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,order.length*3);
      }else{
        ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
        const rx=canvas.width/view.w,ry=canvas.height/view.h;
        for(const i of order){
          const t=s.triangles[i],{a,b,c}=t,l=Math.min(a.u,b.u,c.u),h=Math.min(a.v,b.v,c.v),w=Math.max(a.u,b.u,c.u)-l,k=Math.max(a.v,b.v,c.v)-h;
          if(Math.max(a.x,b.x,c.x)<view.x||Math.min(a.x,b.x,c.x)>view.x+view.w||Math.max(a.y,b.y,c.y)<view.y||Math.min(a.y,b.y,c.y)>view.y+view.h)continue;
          const side=t.front?0:1,mirror=(s.dir<0)!==(side===1),im=images[side],[xx,yx,xy,yy,dx,dy]=t.m;
          ctx.save();ctx.setTransform(rx*xx,ry*yx,rx*xy,ry*yy,(dx-view.x)*rx,(dy-view.y)*ry);
          ctx.beginPath();ctx.moveTo(a.u,a.v);ctx.lineTo(b.u,b.v);ctx.lineTo(c.u,c.v);ctx.closePath();ctx.clip();
          if(mirror){ctx.translate(480,0);ctx.scale(-1,1);}
          const u=mirror?480-l-w:l;ctx.drawImage(im,u*im.width/480,h*im.height/704,w*im.width/480,k*im.height/704,u,h,w,k);
          if(t.shade*arc>.002){ctx.fillStyle='rgba(56,38,15,'+(t.shade*arc)+')';ctx.fillRect(u,h,w,k);}
          ctx.restore();
        }
      }
      return true;
    }
    function hide(){canvas.remove();images=null;delete host.dataset.turnInk;}
    return {prepare,draw,hide};
  }
  let vectorSerial=0;
  Renderer.vector=function(host,renderPage,painter){
    const doc=host.ownerDocument,ns='http://www.w3.org/2000/svg';
    const make=(type,attrs={})=>{const n=doc.createElementNS(ns,type);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
    const motion=movingInk(host,painter);
    let layer,defs,shadow,stock,group,nodes,faces,dir,prefix,lastOrder='',gridKey='',tiles,patches,pages,accelerated;
    function hide(){motion?.hide();layer?.remove();layer=patches=defs=group=stock=shadow=faces=tiles=nodes=null;lastOrder=gridKey='';delete host.dataset.curlProgress;delete host.dataset.curlHeight;delete host.dataset.curlCorner;}
    function prepare(front,back,direction,light=false){
      hide();dir=direction;prefix='turn-leaf-'+(++vectorSerial)+'-';
      layer=make('svg',{class:'paper-vector-turn',viewBox:'0 0 960 704','aria-hidden':'true'});defs=make('defs');layer.appendChild(defs);
      pages=[front,back];faces=null;
      shadow=make('path',{fill:'#4d3c2b'});stock=make('path',{fill:'#f8f3e4','fill-rule':'nonzero'});group=make('g');
      layer.append(shadow,stock,group);host.appendChild(layer);nodes=[];host.dataset.renderer='svg-curved-sheet';
      accelerated=!!motion;
      if(accelerated)try{motion.prepare(front,back,light);}catch{motion.hide();accelerated=false;}
      if(!accelerated)prepareVectors();
    }
    function prepareVectors(){
      faces=pages.map((page,i)=>{
        const src=renderPage(page).replace(/^<svg\b[^>]*>|<\/svg>$/g,'').replaceAll('paper-'+page+'"',prefix+'paint-'+i+'"').replaceAll('#paper-'+page+')','#'+prefix+'paint-'+i+')');
        const {stock,glyphs}=splitInk(src),paper=make('g',{id:prefix+'paper'+i}),print=make('g');print.innerHTML=stock;
        paper.append(make('rect',{width:480,height:704,fill:'#fffdf1'}),print);defs.appendChild(paper);return glyphs;
      });
    }
    function build(s){
      const key=s.us.join()+'/'+s.vs.join();if(key===gridKey)return;
      gridKey=key;lastOrder='';patches?.remove();group.replaceChildren();nodes=[];
      patches=make('g');defs.appendChild(patches);tiles=[];
      for(let j=0;j<s.rows;j++)for(let i=0;i<s.cols;i++){
        const t=j*s.cols+i,[u,v]=[s.us[i],s.vs[j]],u1=s.us[i+1],v1=s.vs[j+1];
        tiles[t]=faces.map((glyphs,side)=>{
          const id=prefix+'ink'+side+'-'+t,flip=(dir<0)!==(side===1),left=flip?480-u1:u,right=flip?480-u:u1;
          const tile=make('g',{id}),ink=make('g');ink.innerHTML=glyphs.filter(g=>g.r>=left&&g.l<=right&&g.b>=v&&g.t<=v1).map(g=>g.el).join('');
          tile.append(make('use',{href:'#'+prefix+'paper'+side}),ink);if(flip)tile.setAttribute('transform','translate(480 0) scale(-1 1)');
          patches.appendChild(tile);return '#'+id;
        });
      }
      for(const [i,t] of s.triangles.entries()){
        const cid=prefix+'clip'+i,clip=make('clipPath',{id:cid,clipPathUnits:'userSpaceOnUse'});
        clip.appendChild(make('path',{d:'M'+[t.a,t.b,t.c].map(q=>q.u+' '+q.v).join('L')+'Z'}));patches.appendChild(clip);
        const g=make('g'),cut=make('g',{'clip-path':'url(#'+cid+')'}),ink=make('use'),shade=make('rect',{width:480,height:704,fill:'#38260f'});
        cut.append(ink,shade);g.appendChild(cut);group.appendChild(g);nodes.push({g,ink,shade,last:null});
      }
    }
    function draw(options){
      const s=surface({...options,direction:dir}),p=options.progress;
      const xy=q=>round(q.x)+' '+round(q.y);
      // All projected triangles have the same fill winding in the safety
      // stock. Folded-back overlaps add coverage rather than cutting holes.
      const d=s.triangles.map(t=>'M'+xy(t.a)+'L'+xy(t.winding?t.b:t.c)+'L'+xy(t.winding?t.c:t.b)+'Z').join('');
      stock.setAttribute('d',d);shadow.setAttribute('d',d);const arc=Math.sin(Math.PI*p);
      shadow.setAttribute('opacity',String(.14*arc));shadow.setAttribute('transform','translate('+dir*arc*11+' '+arc*5+')');
      const order=s.triangles.map((_,i)=>i).sort((a,b)=>s.triangles[a].z-s.triangles[b].z);
      if(accelerated&&!motion.draw(s,order,arc)){motion.hide();accelerated=false;prepareVectors();}
      if(!accelerated){
      build(s);if(order.join()!==lastOrder){for(const i of order)group.appendChild(nodes[i].g);lastOrder=order.join();}
      s.triangles.forEach((t,i)=>{const n=nodes[i];n.g.setAttribute('transform','matrix('+t.m.join(' ')+')');
        if(n.last!==t.front){n.ink.setAttribute('href',tiles[t.tile][t.front?0:1]);n.last=t.front;}
        n.shade.setAttribute('opacity',String(t.shade*arc));
      });}
      host.dataset.curlProgress=p.toFixed(4);host.dataset.curlHeight=Math.max(...s.points.map(q=>q.z)).toFixed(2);
      host.dataset.curlCorner=options.smooth?'none':options.corner||((options.grabY??600)<352?'top':'bottom');return maskFor(s).css;
    }
    return {prepare,draw,hide};
  };
  Renderer.vectorSurface=surface;Renderer.vectorMask=maskFor;
  Renderer.projectBoundPoint=projectBoundPoint;
  Renderer.originWeight=originWeight;
  Renderer.originProfile=originProfile;
  Renderer.applyOriginSurface=applyOriginSurface;
  root.PaperSheetRenderer=Renderer;
})(window);
