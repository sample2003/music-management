const { spawn } = require('child_process');
const path = require('path');

// Python 脚本路径
const pythonScriptPath = path.join('D:\\code\\explainSong', 'main.py');

// 调用 Python 脚本
const pythonProcess = spawn('D:\\code\\explainSong\\venv\\Scripts\\python.exe', [pythonScriptPath], {
  cwd: 'D:\\code\\explainSong' // 设置工作目录为脚本所在目录
});


// 监听 stdout 数据
pythonProcess.stdout.on('data', (data) => {
  console.log(`Python script output: ${data}`);
});

// 监听 stderr 数据
pythonProcess.stderr.on('data', (data) => {
  console.error(`Python script error: ${data}`);
});

// 监听进程结束
pythonProcess.on('close', (code) => {
  console.log(`Python script exited with code ${code}`);
});