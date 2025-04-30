
const { spawn } = require('child_process');
const path = require('path');

const python = {
  script: path.resolve('D:/code/explainSong/app.py'),
  env: path.resolve('D:/code/explainSong/venv/Scripts/python.exe')
};

async function analyzeAudioFeatures(filePath) {
  return new Promise((resolve, reject) => {
    const args = [python.script, filePath];
    const options = {
      cwd: path.dirname(python.script),
      windowsHide: true
    };

    const process = spawn(python.env, args, options);
    let output = '';
    let error = '';

    process.stdout.on('data', (data) => output += data);
    process.stderr.on('data', (data) => error += data);

    process.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python 异常退出 (${code}): ${error}`));
      }

      try {
        const result = JSON.parse(output);
        if (result.status === 'success') {
          resolve(result.data);
        } else {
          reject(new Error(`特征提取失败: ${result.message || '未知错误'}`));
        }
      } catch (e) {
        reject(new Error(`输出解析失败: ${e.message}`));
      }
    });
  });
}

module.exports = { analyzeAudioFeatures };