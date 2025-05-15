const express = require('express');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const cors = require('cors');
const mm = require('music-metadata');
const mysql = require("mysql2/promise");
const { analyzeAudioFeatures } = require('./parse');

const app = express();
const BASE_PATH = process.env.MUSIC_BASE || 'L:\\music';
const coverFolder = path.join('L:\\cover'); // 封面文件夹路径
const lyricsFolder = path.join('L:\\lyric'); // 歌词文件夹路径

/**
 * 配置
 */
// 启用 CORS
app.use(cors());

// 数据库配置
const dbConfig = {
  host: 'localhost',
  port: 3307,
  user: 'root',
  password: '123456',
  database: 'sample_music'
};

// api配置
const API = "http://localhost"
const PORT = process.env.PORT || 3000;
const PATH = API + ":" + PORT

/**
 * 将元数据处理后加入数据库
 *
 */
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 1.
async function processMusicFiles(fullPath) {
    const connection = await pool.getConnection();
  try {
    const files = await getAllMusicFiles(fullPath);
    let processed = 0;
    const total = files.length;
    const startTime = Date.now();

    for (const file of files) {
      await saveToDatabase(connection, file);
      processed++;

      // 每处理10%或至少每10条输出进度
      // 修改日志触发条件为：
      if (processed % 10 === 0 || processed === total) { // [!++]
        const elapsed = ((Date.now() - startTime)/1000).toFixed(1);
        const percentage = (processed/total*100).toFixed(1);
        console.log(`进度: ${processed}/${total} (${percentage}%) 已用 ${elapsed}s`);

        // 添加预估剩余时间
        const remaining = ((elapsed / processed) * (total - processed)).toFixed(1);
        console.log(`预计剩余时间: ${remaining}s`); // [!++]
      }
    }
  } finally {
    connection.release();
  }
}

/**
 * 解析音乐
 *
 */
// 2. 处理歌曲文件夹
async function getAllMusicFiles(dir) {
  const dirents = await fsp.readdir(dir, {withFileTypes: true});
  const files = await Promise.all(dirents.map(async (dirent) => {
    const resPath = path.resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      return getAllMusicFiles(resPath);
    }
    if (fileType(resPath) === 1) {
      return parseSingleMusicFile(resPath, dir);
/*    } else if (fileType(resPath) === 2) {
      console.log("图片文件：" + resPath)
    } else if (fileType(resPath) === 3) {
      console.log("歌词文件：" + resPath)*/
    } else {
      console.log("无法识别该文件：" + resPath)
    }
  }));
  return files.flat().filter(Boolean);
}

// 3. 检查文件类型
function fileType(filePath) {
  const songType = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
  const pictureType = ['.jpg', '.jpeg', '.png'];
  const textType = ['.lrc', '.txt'];
  if (songType.includes(path.extname(filePath).toLowerCase())) {
    return 1;
  } else if (pictureType.includes(path.extname(filePath).toLowerCase())) {
    return 2;
  } else if (textType.includes(path.extname(filePath).toLowerCase())) {
    return 3;
  } else {
    return 0;
  }
}

// 4. 解析单个歌曲文件
async function parseSingleMusicFile(filePath, dir) {
  try {
    // console.log(await mm.parseFile(filePath))
    const {common, format} = await mm.parseFile(filePath); // 使用 Promise 版本

    let audioFeatures = {};
/*    try {
      audioFeatures = await analyzeAudioFeatures(filePath);
      console.log(`音频特征分析成功: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`特征分析失败: ${filePath}`, error.message);
    }
    console.log(audioFeatures)*/

    // 获取封面格式
    let coverUrl = '';
    if (common.picture && common.picture.length > 0) {
      const coverExt = common.picture[0].format.split('/')[1];
      const coverPath = `${path.basename(filePath, path.extname(filePath))}.${coverExt}`;
      coverUrl = PATH + "/api/cover?path=" + encodeURIComponent(coverPath)
      await fsp.writeFile(path.join(coverFolder, coverPath), common.picture[0].data);
    }

    // 获取歌词
    let lyricUrl = '';
    if (common.lyrics && common.lyrics.length > 0) {
      const lyricsPath = `${path.basename(filePath, path.extname(filePath))}.lrc`;
      lyricUrl = PATH + "/api/lyric?path=" + encodeURIComponent(lyricsPath)
      let lyricsContent = common.lyrics[0];

      // 强制转换为UTF-8并添加BOM
      const utf8Content = '\uFEFF' + lyricsContent.normalize('NFC');

      await fsp.writeFile(path.join(lyricsFolder, lyricsPath), utf8Content, {
        encoding: 'utf8',
        flag: 'w'  // 强制覆盖已存在文件
      });
    }

    // 获取歌曲地址
    const ext = path.extname(filePath).toLowerCase();
    const songPath = `${path.basename(filePath, path.extname(filePath))}${ext}`;
    const songUrl = PATH + "/api/music/stream?path=" + encodeURIComponent(dir.split(BASE_PATH)[1] + "/" + songPath)

    // 获取艺术家
    let artist = ''
    let artists = null;
    if(common.artist !== null && common.artist.length > 0){
      const str = common.artist;
      const artistArray = str.split("&")
      artist = artistArray[0]
      if (artistArray.length > 1) {
        artists = artistArray.slice(1).map(name => name.trim()) || null;
      }
    }

    // 获取歌曲特征
    let features = {};
    /*try {
      features = await analyzeAudioFeatures(filePath);
      console.log(`✅ 特征分析成功: ${path.basename(filePath)}`);
    } catch (err) {
      console.error(`❌ 特征分析失败: ${path.basename(filePath)}`, err.message);
      features = { error: err.message };
    }*/

    let song = {
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: artist || '未知艺术家',
      artists: artists,
      album: common.album || '未知专辑',
      mp3_url: null,
      flac_url: null,
      bit_depth: null,
      sampleRate: format.sampleRate,
      duration: format.duration,
      features: features,
      file_size: (await fsp.stat(filePath)).size, // 使用 Promise 版本
      cover: coverUrl,
      lyric: lyricUrl,
      year: common.year,
      style: common.genre?.join(', ') || ''
    }

    // 根据歌曲格式添加对应url字段
    if (ext === '.mp3') {
      song = {
        ...song,
        mp3_url: songUrl,
      };
    } else if (ext === '.flac') {
      song = {
        ...song,
        flac_url: songUrl,
        bit_depth: format.bitsPerSample || 16 // 添加位深度
      };
    } else


    {
      song = {
        ...song,
        mp3_url: songUrl,
      };
    }

    return song;
  } catch (error) {
    console.error(`处理文件失败: ${filePath}`, error);
    return null;
  }
}

// 5. 将歌曲数据存入数据库（同时存歌曲特征）
/*async function saveToDatabase(connection, song) {
  // console.log(song.audio_features)
  try {
    // 先查询是否已存在相同标题
    const [existing] = await connection.execute(
      'SELECT id, title, artist_id, mp3_url, flac_url FROM song_own WHERE title = ? LIMIT 1',
      [song.title]
    );

    // 存在相同标题情况
    if (existing.length > 0) {
      // 同时艺术家相同情况
      const [artist] = await connection.execute(
        'SELECT name FROM artist WHERE id = ? limit 1',
        [existing[0].artist_id]
      );
      console.log(artist[0].name)
      if (artist[0].name === song.artist) {
        if (song.mp3_url && existing[0].mp3_url === null) {
          await connection.execute(
            'UPDATE song_own SET mp3_url = ? WHERE id = ?',
            [song.mp3_url, existing[0].id]
          );
        } else if (song.flac_url && existing[0].flac_url === null) {
          await connection.execute(
            'UPDATE song_own SET flac_url = ? WHERE id = ?',
            [song.flac_url, existing[0].id]
          );
        } else {
          console.log(`跳过重复歌曲: ${song.title}`);
        }
        return;
      }
    }

    // 查询艺术家id
    let artistId = null;
    [artistId] = await connection.execute(
      'SELECT id FROM artist WHERE name = ? limit 1',
      [song.artist]
    );
    if (artistId[0] !== null) {
      await connection.execute(
        'INSERT INTO artist (name) VALUES (?)', [song.artist]
      );
      [artistId] = await connection.execute(
        'SELECT id FROM artist WHERE name = ? limit 1',
        [song.artist]
      )
    }

    // 查询专辑id
    let albumId = null;
    [albumId] = await connection.execute(
      'SELECT id FROM album WHERE title = ?',
      [song.album]
    );
    if (albumId[0] !== null) {
      await connection.execute(
        'INSERT INTO album (title) VALUES (?)', [song.album]
      );
      [albumId] = await connection.execute(
        'SELECT id FROM album WHERE title = ? limit 1',
        [song.album]
      )
    }

    // 插入数据至歌曲表
    await connection.execute(
      `INSERT INTO song_own (title, artist_id, artists, album_id, mp3_url, flac_url, duration, cover, lyric, year) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [song.title, artistId[0].id, song.artists, albumId[0].id, song.mp3_url, song.flac_url, song.duration, song.cover, song.lyric, song.year]
    );
    const [songId] = await connection.execute(
      'SELECT id FROM song WHERE title = ? and artist = ? limit 1',
      [song.title, song.artist]
    )

    console.log(song.features)

    // 插入数据至歌曲特征表
    await connection.execute(
      `INSERT INTO song_feature (song_id, mfcc, tempo, sampleRate, bit_depth) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [songId[0].id, song.sampleRate, song.bit_depth]
    );
  } catch (error) {
    console.error('数据库保存失败:', error);
  }
}*/

// 5. 将歌曲数据存入数据库
async function saveToDatabase(connection, song) {
  try {
    // 先查询是否已存在相同标题
    const [existing] = await connection.execute(
      'SELECT id, title, artist_id, mp3_url, flac_url FROM song_own WHERE title = ? LIMIT 1',
      [song.title]
    );

    // 存在相同标题情况
    if (existing.length > 0) {
      // 同时艺术家相同情况
      const [artist] = await connection.execute(
        'SELECT name FROM artist WHERE id = ? limit 1',
        [existing[0].artist_id]
      );
      if (artist[0].name === song.artist) {
        if (song.mp3_url && existing[0].mp3_url === null) {
          await connection.execute(
            'UPDATE song_own SET mp3_url = ? WHERE id = ?',
            [song.mp3_url, existing[0].id]
          );
        } else if (song.flac_url && existing[0].flac_url === null) {
          await connection.execute(
            'UPDATE song_own SET flac_url = ? WHERE id = ?',
            [song.flac_url, existing[0].id]
          );
        } else {
          console.log(`跳过重复歌曲: ${song.title}`);
        }
        return;
      }
    }

    // 查询艺术家是否存在
    const [artistRows] = await connection.execute(
      'SELECT id FROM artist WHERE name = ? LIMIT 1',
      [song.artist]
    );

    let artistId;
    if (artistRows.length === 0) {
      // 插入新艺术家
      await connection.execute(
        'INSERT INTO artist (name) VALUES (?)',
        [song.artist]
      );
      // 获取新插入的 ID
      const [newArtist] = await connection.execute('SELECT LAST_INSERT_ID() AS id');
      artistId = newArtist[0].id;
    } else {
      artistId = artistRows[0].id; // 使用已存在的 ID
    }

    // 查询专辑是否存在
    const [albumRows] = await connection.execute(
      'SELECT id FROM album WHERE title = ? LIMIT 1',
      [song.album]
    );

    let albumId;
    if (albumRows.length === 0) {
      // 插入新专辑
      await connection.execute(
        'INSERT INTO album (title) VALUES (?)',
        [song.album]
      );
      // 获取新插入的 ID
      const [newAlbum] = await connection.execute('SELECT LAST_INSERT_ID() AS id');
      albumId = newAlbum[0].id;
    } else {
      albumId = albumRows[0].id; // 使用已存在的 ID
    }

    // 插入数据至歌曲表
    await connection.execute(
      `INSERT INTO song_own (title, artist_id, artists, album_id, mp3_url, flac_url, duration, cover, lyric, year) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [song.title, artistId, song.artists, albumId, song.mp3_url, song.flac_url, song.duration, song.cover, song.lyric, song.year]
    );
  } catch (error) {
    console.error('数据库保存失败:', error);
  }
}

/**
 * API
 */

// 解析歌曲文件夹
/*app.get('/api/music/parse', async (req, res) => {
  try {
    await processMusicFiles();
    res.status(200).json({success: "解析歌曲文件夹成功"})
  } catch (error) {
    res.status(500).json({error: '无法解析歌曲文件夹'});
  }
});*/

app.post('/api/music/parse', async (req, res) => {
  try {
    const folderParam = req.query.folder;
    if (!folderParam) {
      return res.status(400).json({ error: '缺少folder参数' });
    }

    // 安全验证
    const normalized = path.normalize(folderParam);
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      return res.status(400).json({ error: '非法路径参数' });
    }

    // 构造完整路径
    const fullPath = path.join(BASE_PATH, normalized);

    // 验证路径存在性
    try {
      await fsp.access(fullPath);
    } catch {
      return res.status(404).json({ error: fullPath+'路径不存在' });
    }

    try {
      await processMusicFiles(fullPath);
      res.status(200).json({success: "解析歌曲文件夹成功"})
    } catch (error) {
      res.status(500).json({error: '无法解析歌曲文件夹'});
    }

  } catch (error) {
    console.error('解析失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 解析单曲
app.get('/api/music/single/parse', async (req, res) => {
  try {
    await processMusicFiles();
    res.status(200).json({success: "解析歌曲文件夹成功"})
  } catch (error) {
    res.status(500).json({error: '无法解析歌曲文件夹'});
  }
});

// 获取流式歌曲
app.get('/api/music/stream', async (req, res) => {
  try {
    const filePath = path.join(BASE_PATH, req.query.path);

    const stat = await fsp.stat(filePath); // 使用 Promise 版本
    const fileExt = path.extname(filePath).toLowerCase();

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

// 获取歌曲封面
app.get('/api/cover', async (req, res) => {
  try {
    const param = req.query.path;

    const fullPath = path.join(coverFolder, param);

    // 防止路径遍历攻击
    if (!fullPath.startsWith(path.resolve(coverFolder))) {
      return res.status(400).json({error: '非法文件路径'});
    }

    // 5. 获取文件信息并返回
    const stat = await fsp.stat(fullPath);
    res.writeHead(200, {
      // 'Content-Type': getImageMimeType(path.extname(fullPath)),
      'Content-Type': 'jpg',
      'Content-Length': stat.size
    });

    fs.createReadStream(fullPath).pipe(res);

  } catch (error) {
    console.error('封面获取错误:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({error: '封面文件不存在'});
    } else {
      res.status(500).json({error: '服务器内部错误'});
    }
  }
});

// 获取歌词
app.get('/api/lyric', async (req, res) => {
  try {
    const param = req.query.path;

    const fullPath = path.join(lyricsFolder, param);

    // 防止路径遍历攻击
    if (!fullPath.startsWith(path.resolve(lyricsFolder))) {
      return res.status(400).json({error: '非法文件路径'});
    }

    // 5. 获取文件信息并返回
    const stat = await fsp.stat(fullPath);
    res.writeHead(200, {
      'Content-Type': 'txt',
      'Content-Length': stat.size
    });

    fs.createReadStream(fullPath).pipe(res);

  } catch (error) {
    console.error('歌词获取错误:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({error: '歌词文件不存在'});
    } else {
      res.status(500).json({error: '服务器内部错误'});
    }
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 ${API}:${PORT}`);
});