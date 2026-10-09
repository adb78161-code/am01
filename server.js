import http from 'node:http';
import crypto from 'node:crypto';
import {WebSocketServer} from 'ws';

const PORT=Number(process.env.PORT||10000), TTL=20*60*1000;
const sessions=new Map(), clients=new Map();
const id=()=>crypto.randomBytes(12).toString('base64url');
const send=(ws,m)=>ws?.readyState===1&&ws.send(JSON.stringify(m));
const closeSession=s=>{
  for(const p of s.peers.values()){send(p.ws,{type:'session-ended',reason:'expired'});try{p.ws.close()}catch{}clients.delete(p.ws)}
  sessions.delete(s.id);
};
setInterval(()=>{for(const s of sessions.values())if(Date.now()>=s.expiresAt)closeSession(s)},30000);

const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url==='/health'){
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'amo1-signaling'}));return;
  }
  res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({server,path:'/signal'});

wss.on('connection',ws=>{
  const peerId=id(); clients.set(ws,{peerId,sessionId:null,role:null});
  send(ws,{type:'hello',peerId});

  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    const c=clients.get(ws);if(!c)return;

    if(m.type==='create-session'){
      const sid=crypto.randomBytes(18).toString('base64url');
      const s={id:sid,hostId:peerId,createdAt:Date.now(),expiresAt:Date.now()+TTL,peers:new Map()};
      s.peers.set(peerId,{id:peerId,ws,role:'host'});sessions.set(sid,s);
      c.sessionId=sid;c.role='host';
      send(ws,{type:'session-created',sessionId:sid,peerId,expiresAt:s.expiresAt});return;
    }

    if(m.type==='join-session'){
      const s=sessions.get(String(m.sessionId||''));
      if(!s||Date.now()>=s.expiresAt){send(ws,{type:'error',message:'Session not found or expired'});return}
      s.peers.set(peerId,{id:peerId,ws,role:'participant'});
      c.sessionId=s.id;c.role='participant';
      send(ws,{type:'joined',sessionId:s.id,peerId,hostPeerId:s.hostId,expiresAt:s.expiresAt});
      const host=s.peers.get(s.hostId);send(host?.ws,{type:'peer-joined',peerId});return;
    }

    const s=c.sessionId?sessions.get(c.sessionId):null;if(!s)return;
    if(m.type==='signal'){
      const target=s.peers.get(m.to);if(target)send(target.ws,{type:'signal',from:peerId,data:m.data});
    } else if(m.type==='device-info'){
      const host=s.peers.get(s.hostId);if(host)send(host.ws,{type:'device-info',from:peerId,info:m.info});
    } else if(m.type==='end-session'&&c.role==='host'){
      for(const p of s.peers.values())send(p.ws,{type:'session-ended',reason:'host-ended'});
      for(const p of s.peers.values()){try{p.ws.close()}catch{}clients.delete(p.ws)}sessions.delete(s.id);
    }
  });

  ws.on('close',()=>{
    const c=clients.get(ws);clients.delete(ws);if(!c?.sessionId)return;
    const s=sessions.get(c.sessionId);if(!s)return;s.peers.delete(c.peerId);
    if(c.role==='host'){
      for(const p of s.peers.values()){send(p.ws,{type:'session-ended',reason:'host-disconnected'});try{p.ws.close()}catch{}clients.delete(p.ws)}
      sessions.delete(s.id);
    }else send(s.peers.get(s.hostId)?.ws,{type:'peer-left',peerId:c.peerId});
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Amo1 signaling listening on ${PORT}`));