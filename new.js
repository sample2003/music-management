const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const cors = require('cors');
const mm = require('music-metadata');
const mysql = require('mysql2/promise');
const {log} = require('console');

const app = express();
const musicFolder = path.join('L:\\text');
const coverFolder = path.join(musicFolder, 'public', 'covers');
const lyricsFolder = path.join(musicFolder, 'public', 'lyrics');

// 创建必要目录
fs.mkdirSync(coverFolder, {recursive: true});
fs.mkdirSync(lyricsFolder, {recursive: true});

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: '123456',
  database: 'sample_music'
};

// 创建数据库连接池
const pool = mysql.createPool(dbConfig);

// 启用CORS和静态文件服务
app.use(cors());
app.use('/public', express.static('public'));

// 获取音乐列表
app.get('/api/music', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM song_own');
    connection.release();
    res.json(rows);
  } catch (error) {
    res.status(500).json({error: '数据库查询失败'});
  }
});


app.get('/api/music/stream', async (req, res) => {
  try {
    const filePath = path.join(musicFolder, req.query.path);

    if (!filePath.startsWith(musicFolder)) {
      return res.status(400).send('无效的文件路径');
    }

    const stat = await fsp.stat(filePath); // 使用 Promise 版本
    const fileExt = path.extname(filePath).toLowerCase();
    console.log(fileExt)

    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac'
    };

    res.writeHead(200, {
      'Content-Type': mimeTypes[fileExt] || 'audio/mpeg',
      'Content-Length': stat.size
    });

    const readStream = fs.createReadStream(filePath); // 使用原始 fs
    readStream.pipe(res);
  } catch (error) {
    res.status(404).send('文件未找到');
  }
});

// 新增封面访问端点
app.get('/api/cover', async (req, res) => {
  try {
    const filePath = path.join(coverFolder, req.query.path);
    res.sendFile(filePath);
  } catch (error) {
    res.status(404).send('封面未找到');
  }
});

// 新增歌词访问端点
app.get('/api/lyrics', async (req, res) => {
  try {
    const filePath = path.join(lyricsFolder, req.query.path);
    res.sendFile(filePath);
  } catch (error) {
    res.status(404).send('歌词未找到');
  }
});

// 改进后的文件处理函数
async function processMusicFiles() {
  const connection = await pool.getConnection();
  try {
    const files = await getAllMusicFiles(musicFolder);
    for (const file of files) {
      await saveToDatabase(connection, file);
    }
  } finally {
    connection.release();
  }
}

async function getAllMusicFiles(dir) {
  const dirents = await fsp.readdir(dir, {withFileTypes: true});
  const files = await Promise.all(dirents.map(async (dirent) => {
    const resPath = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      return getAllMusicFiles(resPath);
    } else if (isMusicFile(resPath)) {
      return processSingleFile(resPath);
    }
  }));
  return files.flat().filter(Boolean);
}

async function processSingleFile(filePath) {
  try {
    const metadata = await mm.parseFile(filePath);
    console.log(metadata)
    const {common, format} = metadata;

    // 处理封面
    let coverPath = '';
    if (common.picture && common.picture.length > 0) {
      const coverExt = common.picture[0].format.split('/')[1];
      coverPath = `${path.basename(filePath, path.extname(filePath))}.${coverExt}`;
      await fsp.writeFile(path.join(coverFolder, coverPath), common.picture[0].data);
    }

    // 处理歌词
    let lyricsPath = '';
    const lyricsFile = path.join(path.dirname(filePath),
      `${path.basename(filePath, path.extname(filePath))}.lrc`);
    if (await fileExists(lyricsFile)) {
      lyricsPath = path.relative(musicFolder, lyricsFile);
      await fsp.copyFile(lyricsFile, path.join(lyricsFolder, path.basename(lyricsFile)));
    }

    return {
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artists?.join(', ') || '未知艺术家',
      album: common.album || '未知专辑',
      duration: format.duration,
      flac_url: path.relative(musicFolder, filePath),
      file_size: (await fsp.stat(filePath)).size,
      cover: coverPath,
      lyric: lyricsPath,
      release_date: common.year,
      style: common.genre?.join(', ') || ''
    };
  } catch (error) {
    console.error(`处理文件失败: ${filePath}`, error);
    return null;
  }
}

async function saveToDatabase(connection, song) {
  try {
    await connection.execute(
      `INSERT INTO song_own (title, artist, album, duration) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        artist = VALUES(artist),
        album = VALUES(album),
        duration = VALUES(duration)`,
      [
        song.title, song.artist, song.album, song.duration
      ]
    );
  } catch (error) {
    console.error('数据库保存失败:', error);
  }
}

// 辅助函数
function isMusicFile(filePath) {
  return ['.mp3', '.wav', '.flac', '.ogg'].includes(path.extname(filePath).toLowerCase());
}

async function fileExists(path) {
  try {
    await fsp.access(path);
    return true;
  } catch {
    return false;
  }
}

// 启动时处理音乐文件
processMusicFiles().then(() => {
  console.log('音乐库初始化完成');
  app.listen(3000, () => {
    console.log('服务器运行在 http://localhost:3000');
  });
});