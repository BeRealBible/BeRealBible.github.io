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
  function strips(options,n=10){
    const step=480/n,points=[];
    for(let i=0;i<=n;i++){
      const p=P.point({...options,vertical:0},i*step,0);
      points.push({x:p.x,y:p.y-p.z*P.SLOPE,z:p.z});
    }
    const bands=Array.from({length:n},(_,i)=>{
      const a=points[i],b=points[i+1],front=(b.x-a.x)*options.direction>=0;
      const ascending=b.x>=a.x,[l,r]=ascending?[a,b]:[b,a];
      return {front,offset:ascending?i*step:480-(i+1)*step,
        x:l.x,y:l.y,xx:(r.x-l.x)/step,yx:(r.y-l.y)/step,z:(a.z+b.z)/2};
    });
    const covered=Math.max(0,...points.map(p=>(p.x-480)*options.direction));
    return {points,bands,covered:Math.min(480,covered)};
  }
  let vectorSerial=0;
  Renderer.vector=function(host,renderPage){
    const n=10,w=480/n,doc=host.ownerDocument,ns='http://www.w3.org/2000/svg';
    const make=(type,attrs={})=>{
      const node=doc.createElementNS(ns,type);
      for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node;
    };
    let layer,shadow,stock,group,nodes,ids,dir,lastOrder='';
    function hide(){layer?.remove();layer=null;nodes=null;lastOrder='';delete host.dataset.curlProgress;}
    function prepare(front,back,direction){
      hide();dir=direction;const prefix='turn-leaf-'+(++vectorSerial)+'-';
      layer=make('svg',{class:'paper-vector-turn',viewBox:'0 0 960 704','aria-hidden':'true'});
      const defs=make('defs');layer.appendChild(defs);
      ids=[front,back].map((page,i)=>{
        const id=prefix+i,g=make('g',{id}),nested=make('svg',{width:480,height:704,viewBox:'0 0 480 704'});
        // Each private copy gets distinct paint-server IDs from the static page.
        nested.innerHTML=renderPage(page).replace(/^<svg\b[^>]*>|<\/svg>$/g,'').replaceAll('paper-'+page+'"',prefix+'paint-'+i+'"').replaceAll('#paper-'+page+')','#'+prefix+'paint-'+i+')');
        g.appendChild(make('rect',{width:480,height:704,fill:'#fffdf1'}));g.appendChild(nested);defs.appendChild(g);
        return '#'+id;
      });
      shadow=make('path',{fill:'#4d3c2b'});stock=make('path',{fill:'#f8f3e4'});group=make('g');
      layer.append(shadow,stock,group);
      nodes=Array.from({length:n},()=>{
        const g=make('g'),slice=make('svg',{width:w,height:704,overflow:'hidden',preserveAspectRatio:'none'});
        const ink=make('use'),shade=make('rect',{x:0,y:0,width:w,height:704,fill:'#38260f'});
        slice.appendChild(ink);g.append(slice,shade);group.appendChild(g);
        return {g,slice,ink,shade,last:null};
      });
      host.appendChild(layer);host.dataset.renderer='svg-curved-sheet';
    }
    function draw(options){
      const s=strips({...options,direction:dir},n),p=options.progress;
      const d='M'+s.points.map(pt=>pt.x+' '+pt.y).join('L')+'L'+s.points.slice().reverse().map(pt=>pt.x+' '+(pt.y+704)).join('L')+'Z';
      stock.setAttribute('d',d);shadow.setAttribute('d',d);const arc=Math.sin(Math.PI*p);
      shadow.setAttribute('opacity',String(.13*arc));shadow.setAttribute('transform','translate('+dir*arc*15+' '+arc*6+')');
      const order=s.bands.map((_,i)=>i).sort((i,j)=>s.bands[i].z-s.bands[j].z);
      if(order.join()!==lastOrder){for(const i of order)group.appendChild(nodes[i].g);lastOrder=order.join();}
      s.bands.forEach((b,i)=>{
        const row=nodes[i];row.g.setAttribute('transform','matrix('+[b.xx,b.yx,0,1,b.x,b.y].join(' ')+')');
        if(row.last!==b.front){
          row.ink.setAttribute('href',ids[b.front?0:1]);row.slice.setAttribute('viewBox',[b.offset,0,w,704].join(' '));row.last=b.front;
        }
        row.shade.setAttribute('opacity',String(.13*(1-Math.min(1,b.xx))*arc));
      });
      host.dataset.curlProgress=p.toFixed(4);return s.covered;
    }
    return {prepare,draw,hide};
  };
  Renderer.strips=strips;
  Renderer.projectBoundPoint=projectBoundPoint;
  Renderer.originWeight=originWeight;
  Renderer.originProfile=originProfile;
  Renderer.applyOriginSurface=applyOriginSurface;
  root.PaperSheetRenderer=Renderer;
})(window);
