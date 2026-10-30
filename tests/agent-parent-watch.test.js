'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { launchRuntime } = require('../lib/agent/stdio');
const { removeFixture } = require('./helpers/agent-bundle-fixture');

describe('runtime parent-watch and bounded stop contract', () => {
  let root, outer, fakePid;
  beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'openyida-parent-watch-'));});
  afterEach(() => {
    jest.useRealTimers();
    if (outer && outer.exitCode === null && outer.signalCode === null) {outer.kill('SIGKILL');}
    if (fakePid) {try {process.kill(fakePid, 'SIGKILL');} catch { /* Owned fixture already exited. */ }}
    removeFixture(root);
  });
  test('stdin EOF preserves runtime; parent death triggers the platform lifetime monitor', async () => {
    const binary = path.join(root, 'fake-runtime.js');
    const receipt = path.join(root, 'parent-ended.json');
    const source = `const fs=require('fs');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{
      const c=JSON.parse(text);const stopped=()=>{fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({parentStopped:true,notCompletion:true}));process.chdir(require('os').tmpdir());process.exit(0);};
      const ready=()=>console.log(JSON.stringify({type:'ready',pid:process.pid,stdinEnded:true,parentPID:c.parentPID,watchFD:c.parentWatchFD}));
      if(c.parentPID){
        // Acquire the native process handle before reporting ready. PowerShell
        // cold module loading can exceed 15s; it is not a slow parent exit.
        const ps=require('path').join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
        const command='$ErrorActionPreference="Stop";$p=Get-Process -Id '+c.parentPID+';[Console]::Out.WriteLine("watch-ready");$p.WaitForExit()';
        const monitor=require('child_process').spawn(ps,['-NoProfile','-NonInteractive','-Command',command],{stdio:['ignore','pipe','pipe'],windowsHide:true});
        let output='';let announced=false;
        monitor.stdout.on('data',chunk=>{output+=chunk;if(!announced && output.includes('watch-ready')){announced=true;ready();}});
        monitor.stderr.on('data',chunk=>process.stderr.write(chunk));
        monitor.once('error',()=>process.exit(1));
        monitor.once('exit',code=>{if(code===0 && announced){stopped();}else{process.exit(1);}});
      }
      else{const watch=fs.createReadStream(null,{fd:c.parentWatchFD,autoClose:false});watch.on('end',stopped);watch.resume();ready();}});`;
    fs.writeFileSync(binary, source);
    const modulePath = path.resolve(__dirname, '../lib/agent/stdio.js');
    const config = { command: 'run', protocolVersion: 1, developmentRuntime: true, node: { packageRoot: root } };
    const code = `const {spawn}=require('child_process');require(${JSON.stringify(modulePath)}).launchRuntime({executable:${JSON.stringify(binary)}},${JSON.stringify(config)},
      {spawn:(file,args,options)=>spawn(process.execPath,[file,...args],options)}).catch(()=>{process.exitCode=1;});`;
    outer = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    const event = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fixture readiness timed out')), process.platform === 'win32' ? 45000 : 10000);
      let text = '';
      outer.stdout.on('data', chunk => {
        text += chunk;
        if (text.includes('\n')) {clearTimeout(timeout); resolve(JSON.parse(text.split('\n')[0]));}
      });
      outer.once('error', error => {clearTimeout(timeout); reject(error);});
    });
    fakePid = event.pid;
    expect(event).toMatchObject({ type: 'ready', stdinEnded: true,
      ...(process.platform === 'win32' ? { parentPID: outer.pid } : { watchFD: 3 }) });
    expect(fs.existsSync(receipt)).toBe(false);
    outer.kill('SIGKILL');
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const interval = setInterval(() => {
        if (fs.existsSync(receipt)) {clearInterval(interval); resolve();}
        else if (Date.now() > deadline) {clearInterval(interval); reject(new Error('fixture never saw parent termination'));}
      }, 25);
    });
    expect(JSON.parse(fs.readFileSync(receipt, 'utf8'))).toEqual({ parentStopped: true, notCompletion: true });
  }, process.platform === 'win32' ? 65000 : 25000);

  function childFixture() {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
    jest.spyOn(child.stdin, 'end');
    child.kill = jest.fn();
    return child;
  }
  test('malformed output requests graceful stop before the bounded force kill', async () => {
    jest.useFakeTimers();
    const child = childFixture(), control = childFixture();
    const signals = new EventEmitter();
    const spawnFake = jest.fn((_file, args) => args[0] === 'disconnect' ? control : child);
    const pending = launchRuntime({ executable: '/fake-only' }, { command: 'run', node: { packageRoot: root } }, { spawn: spawnFake, signals });
    const outcome = pending.catch(error => error);
    expect(spawnFake.mock.calls[0][2].stdio).toEqual(process.platform === 'win32' ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe']);
    expect(spawnFake.mock.calls[0][2].detached).toBe(process.platform === 'win32');
    child.stdout.write('not-json\n');
    if (process.platform === 'win32') {
      expect(JSON.parse(control.stdin.end.mock.calls[0][0])).toMatchObject({ command: 'disconnect', parentPID: 0, parentWatchFD: 0 });
      expect(child.kill).not.toHaveBeenCalled();
    } else {expect(child.kill).toHaveBeenCalledWith('SIGTERM');}
    jest.advanceTimersByTime(14999);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    jest.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null, 'SIGKILL'); control.emit('close', 1, null);
    expect(await outcome).toMatchObject({ code: 'AGENT_RUNTIME_STOP_UNCONFIRMED', details: { executionState: 'unknown' } });
    if (process.platform !== 'win32') {expect(child.stdio[3].destroyed).toBe(true);}
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
  test('confirmed graceful stop clears the force-kill timer and permits normal completion', async () => {
    jest.useFakeTimers();
    const child = childFixture(), control = childFixture(), signals = new EventEmitter();
    const pending = launchRuntime({ executable: '/fake-only' }, { command: 'run', node: { packageRoot: root } }, {
      signals, stdout: { write() {} }, spawn: (_file, args) => args[0] === 'disconnect' ? control : child,
    });
    child.stdout.write('{"type":"ready","ready":true}\n');
    signals.emit('SIGTERM');
    if (process.platform === 'win32') {
      expect(JSON.parse(control.stdin.end.mock.calls[0][0]).command).toBe('disconnect');
      control.stdout.write('{"type":"disconnected","executionStopped":true}\n'); control.emit('close', 0, null);
    } else {expect(child.kill).toHaveBeenCalledWith('SIGTERM');}
    child.emit('close', 0, null);
    await pending;
    jest.advanceTimersByTime(20000);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
