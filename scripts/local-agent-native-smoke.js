'use strict';

// Real OS processes and the signed published Go runtime. All credentials, CLI
// responses and HTTP/WS services are isolated fixtures; no paid model or app API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const cp = require('child_process');
const assert = require('assert/strict');
const { WebSocketServer } = require('ws');
const { resolveRuntime, canonicalPath } = require('../lib/agent/runtime-package');
const { materializeBundle, verifyBundle } = require('../lib/agent/frozen-bundle');
const { launchRuntime, launchBackgroundRuntime } = require('../lib/agent/stdio');
const { preflight } = require('../lib/agent/provider-preflight');
const { prepareConnection } = require('../lib/agent/connection-store');
const { removeFixture } = require('../tests/helpers/agent-bundle-fixture');

const packageRoot = path.resolve(__dirname, '..');
async function main() {
  const root = canonicalPath(fs.mkdtempSync(path.join(os.tmpdir(), 'oy-native-')));
  const children = new Set();
  let phase='setup';
  let controllerError, devicePublicKey, heartbeatCount = 0, models, epoch = 0, refreshClaimed = false, foreground, nativePid;
  const access = 'old1_' + 'fixture'.repeat(8), ticket = 'a'.repeat(43), endpointId = 'native-smoke';
  const nonce = 'native-smoke-proof-0123456789abcdef';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(check, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (!check()) {
      if (controllerError) {throw controllerError;}
      if (Date.now() > deadline) {throw new Error(label + ' timed out');}
      await pause(50);
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      const parts = []; for await (const chunk of req) {parts.push(chunk);}
      const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
      let response;
      if (req.url === '/api/local-enrollment/v1/web/smoke/claim') {
        assert.equal(body.ticket, ticket);
        devicePublicKey = crypto.createPublicKey({format:'der', type:'spki', key:Buffer.concat([
          Buffer.from('302a300506032b6570032100','hex'), Buffer.from(body.devicePublicKey,'base64url'),
        ])});
        assert.ok(crypto.verify(null, Buffer.from('openyida-enrollment-v1\nsmoke\n'+body.installationId+'\n'+ticket),
          devicePublicKey, Buffer.from(body.deviceSignature,'base64url')));
        const now = Math.floor(Date.now()/1000);
        response = {protocolVersion:1,deviceId:'native-device',accessToken:access,expiresAt:now+3600,
          refreshToken:'olr1_'+'fixture'.repeat(8),refreshExpiresAt:now+7200,credentialVersion:1,refreshSupported:true};
      } else {
        assert.equal(req.headers.authorization, 'Bearer '+access);
        if (req.url === '/api/local-runtime/v1/commands/claim') {
          const payload = {profileId:'openyida.qoder'};
          const commands = refreshClaimed ? [] : [{protocolVersion:1,type:'refresh_models',runtimeId:'runtime-qoder',
            commandId:'refresh-smoke',payload,payloadDigest:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}];
          refreshClaimed = true; response = {protocolVersion:1,commands};
        } else if (req.url === '/api/local-runtime/v1/control') {
          if (body.type === 'heartbeat') {heartbeatCount++;}
          if (body.type === 'models_refreshed') {models = body.payload;}
          response = {protocolVersion:1,type:'ack',requestId:body.requestId};
        } else if (req.url === '/api/local-runtime/v1/discovery/poll') {response = {request:null};}
        else {res.writeHead(404); res.end(); return;}
      }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(response));
    } catch (error) {controllerError = error; res.writeHead(500); res.end('fixture assertion failed');}
  });
  const ws = new WebSocketServer({server, path:'/api/local-runtime/v1/connect'});
  ws.on('connection', (socket, req) => {
    try {assert.equal(req.headers.authorization,'Bearer '+access);} catch (error) {controllerError=error; socket.close(); return;}
    socket.send(JSON.stringify({type:'hello_challenge',protocolVersion:1,deviceId:'native-device',nonce,expiresAt:Math.floor(Date.now()/1000)+10}));
    socket.once('message', bytes => {
      try {
        const hello=JSON.parse(bytes);
        assert.equal(hello.type,'hello'); assert.equal(hello.nonce,nonce);
        assert.ok(crypto.verify(null,Buffer.from('openyida-device-connect-v1\nnative-device\n'+endpointId+'\n'+nonce),
          devicePublicKey,Buffer.from(hello.deviceSignature,'base64url')));
        socket.send(JSON.stringify({type:'hello_ack',protocolVersion:1,deviceId:'native-device',connectionEpoch:++epoch,
          runtimes:hello.runtimes.map(item=>({profileId:item.profileId,runtimeId:'runtime-qoder'})),recoveries:[]}));
      } catch (error) {controllerError=error; socket.close();}
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  function trackedSpawn(executable,args,options) {
    const child=cp.spawn(executable,args,options); children.add(child); child.once('close',()=>children.delete(child));
    if(child.stdout && executable !== process.execPath){
      let pending='';child.stdout.on('data',chunk=>{pending+=chunk;let end;
        while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);
          try{const event=JSON.parse(line);if(event.type==='error'){console.error(JSON.stringify({phase,code:event.code,message:event.message}));}}catch{/* Non-event output. */}
        }
      });
    }
    return child;
  }
  try {
    const dir=path.join(root,"中文 user's folder"); fs.mkdirSync(dir);
    const peer=path.join(dir,'peer.js');
    fs.writeFileSync(peer, `const readline=require('readline');const flags=process.argv.slice(2);
      if(!flags.includes('--acp')){console.log(flags.includes('--version')?'1.0.0':'Logged in');}
      else{readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result={};
        if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{loadSession:true}};
        if(m.method==='session/new')result={sessionId:'fixture-session',models:{currentModelId:'fixture-model',availableModels:[{modelId:'fixture-model',name:'Fixture model'}]}};
        console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});}`);
    let provider;
    if(process.platform==='win32'){
      provider=path.join(dir,'qodercli.cmd'); fs.writeFileSync(provider,'@echo off\r\nexit /b 99\r\n');
      const quote=value=>"'"+value.replace(/'/g,"''")+"'";
      fs.writeFileSync(provider.replace(/\.cmd$/,'.ps1'), `\ufeff& ${quote(process.execPath)} ${quote(peer)} @args\nexit $LASTEXITCODE\n`);
    }else{provider=path.join(dir,'qodercli');fs.writeFileSync(provider,`#!${process.execPath}\nrequire(${JSON.stringify(peer)});\n`,{mode:0o700});}
    phase='cli-preflight';
    const checked=await preflight({provider:'qoder',providerPath:provider});
    assert.equal(checked.ready,true,'native CLI version/auth/ACP handshake');
    phase='runtime-resolution';
    const runtime=resolveRuntime({packageRoot});
    const connectionRoot=path.join(root,'local-agent');
    const prepared=prepareConnection(connectionRoot,'smoke.'+ticket);
    const config={protocolVersion:1,command:'connect',endpoint:'http://127.0.0.1:'+server.address().port,endpointId,
      installationId:prepared.installationId,enrollmentToken:'smoke.'+ticket,stateDir:prepared.stateDir,sessionStateDir:path.join(connectionRoot,'sessions'),
      // Windows uses production DPAPI; Mac fixture avoids altering user Keychain.
      ...(process.platform==='darwin'?{developmentRuntime:true}:{}),
      node:{executable:process.execPath,packageRoot,cliEntry:path.join(packageRoot,'bin/yida.js'),version:require('../package.json').version},
      providers:[{profileId:'openyida.qoder',provider:'qoder',executable:provider}]};
    const frozen=materializeBundle(runtime,config); verifyBundle(frozen.config.bundle.root,frozen.config.bundle.id);
    const stdout={write() {}};
    phase='native-enrollment';
    await launchRuntime(frozen.runtime,frozen.config,{stdout,spawn:trackedSpawn});
    delete frozen.config.enrollmentToken;
    phase='native-background';
    const started=await launchBackgroundRuntime(frozen.runtime,{...frozen.config,command:'run'}, {spawn:trackedSpawn,startupTimeoutMs:60000});
    assert.ok(process.kill(started.pid,0));
    phase='native-model-refresh';
    await waitFor(()=>models,'Go CLI model refresh',90000);
    assert.equal(models.errorCode,undefined); assert.equal(models.models[0].id,'fixture-model');
    phase='heartbeat';
    await waitFor(()=>heartbeatCount>0,'authenticated heartbeat');
    phase='authenticated-disconnect';
    await launchRuntime(frozen.runtime,{...frozen.config,command:'disconnect'},{stdout,spawn:trackedSpawn});
    await waitFor(()=>!children.size,'graceful background exit');
    // A new foreground runtime must stop when its Node owner dies, on both
    // Windows (native PID wait) and Unix (separate lifetime pipe).
    phase='parent-death';
    const launcher=path.join(root,'launcher.js');
    fs.writeFileSync(launcher,`const {spawn}=require('child_process');require(${JSON.stringify(path.join(packageRoot,'lib/agent/stdio'))})
      .launchRuntime(${JSON.stringify({executable:frozen.runtime.executable})},${JSON.stringify({...frozen.config,command:'run'})},{spawn:(exe,args,opts)=>{
        const child=spawn(exe,args,opts);console.log(JSON.stringify({type:'native-pid',pid:child.pid}));return child;}}).catch(()=>process.exitCode=1);`);
    foreground=trackedSpawn(process.execPath,[launcher],{stdio:['ignore','pipe','pipe']});
    let output=''; foreground.stdout.on('data',chunk=>output+=chunk); foreground.stderr.resume();
    await waitFor(()=>output.includes('"type":"ready"'),'foreground native readiness',60000);
    nativePid=output.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(event=>event.type==='native-pid').pid;
    if(process.platform==='win32'){
      // Open and retain the actual process handle before killing its parent.
      // Looking up a PID afterwards can attach to a reused Windows PID.
      const watchScript = `$ErrorActionPreference='Stop';$p=Get-Process -Id ${nativePid};$null=$p.Handle;`+
        '[Console]::Out.WriteLine(\'watch-ready\');if(!$p.WaitForExit(15000)){throw \'Native runtime did not exit\'};exit 0';
      const watcher=trackedSpawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile','-NonInteractive','-Command',watchScript],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let watching='',watchError='';
      watcher.stdout.on('data',chunk=>watching+=chunk);watcher.stderr.on('data',chunk=>watchError+=chunk);
      let watchExit;
      watcher.once('close',code=>{watchExit=code;});
      await waitFor(()=>watching.includes('watch-ready') || watchExit!==undefined,'native handle readiness',45000);
      assert.equal(watchExit,undefined,watchError || 'native watcher exited before readiness');
      foreground.kill('SIGKILL');
      // Go's drain budget is 12s; match the launcher's 15s stop grace.
      await waitFor(()=>watchExit!==undefined,'native parent-death exit',20000);
      assert.equal(watchExit,0,watchError || 'native runtime did not exit');
    }else{
      foreground.kill('SIGKILL');
      await waitFor(()=>{try{process.kill(nativePid,0);return false;}catch{return true;}},'native runtime after parent death');
    }
    await waitFor(()=>!children.size,'launcher exit');
    const statusOutput=[];
    await launchRuntime(frozen.runtime,{...frozen.config,command:'status'},
      {stdout:{write:line=>statusOutput.push(line)},spawn:trackedSpawn});
    const stopped=JSON.parse(statusOutput.join('').trim());
    assert.equal(stopped.running,false);assert.equal(stopped.executionStopped,true);assert.equal(stopped.reconciliationRequired,false);
    console.log(JSON.stringify({platform:process.platform,runtimeVersion:runtime.runtimeVersion,signatureVerified:true,
      frozenBundleVerified:true,cliProtocolPassed:true,goModelRefreshPassed:true,backgroundReady:true,heartbeatPassed:true,
      authenticatedStopPassed:true,nativeParentDeathPassed:true,fixtureController:true,paidModelCalled:false}));
  } catch(error){error.smokePhase=phase;throw error;} finally {
    if(nativePid){try{process.kill(nativePid,'SIGKILL');}catch{/* Already exited. */}}
    if(foreground){try{foreground.kill('SIGKILL');}catch{/* Already exited. */}}
    for(const child of children){try{child.kill('SIGKILL');}catch{/* Already exited. */}}
    await waitFor(()=>!children.size,'owned child cleanup').catch(()=>{});
    for(const client of ws.clients){client.terminate();}
    await new Promise(resolve=>ws.close(resolve)); await new Promise(resolve=>server.close(resolve));
    removeFixture(root);
  }
}
main().catch(error=>{console.error(JSON.stringify({phase:error.smokePhase,code:error.code,message:error.message}));process.exitCode=1;});
