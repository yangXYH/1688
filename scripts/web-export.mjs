import ExcelJS from 'exceljs';
import { embedCellImages } from './web-cell-images.mjs';

const HEADERS = ['图片', '商品编号', '商品标题', '价格', '供应商', '省份', '城市', '销量线索', '复购率', '图片链接', '商品链接', '销量线索来源', '统计周期'];
const WIDTHS = [14, 20, 48, 18, 28, 14, 14, 18, 14, 50, 50, 60, 24];
const EMPTY_VALUES = new Set(['', '暂无销量线索', '价格待查看', '供应商信息待查看', '上游未提供', '上游未提供来源字段', '上游未提供统计周期']);

function populatedColumn(rows, index) {
  // Keep the first column as the in-cell image anchor. Other columns only
  // appear when at least one selected product has actual data, including 0.
  return index === 0 || rows.some((row) => !EMPTY_VALUES.has(String(row[index] ?? '').trim()));
}

async function downloadImage(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['alicdn.com', '1688.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { await response.body.cancel().catch(() => {}); return null; }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const extension = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? 'jpeg'
      : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
    return extension ? { buffer, extension } : null;
  } catch { return null; }
}

export async function createProductWorkbook(rows, imageLoader = downloadImage, context = {}) {
  const originalCount = rows.length;
  if (context.dedupeOfferIds) {
    const seen = new Set();
    rows = rows.filter((row) => {
      const id = String(row[1] ?? '').trim();
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('商品');
  const columns = HEADERS.map((_, index) => index).filter((index) => populatedColumn(rows, index));
  sheet.addRow(columns.map((index) => HEADERS[index]));
  sheet.getRow(1).font = { bold: true };
  sheet.columns = columns.map((index) => ({ width: WIDTHS[index] }));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const source = workbook.addWorksheet('搜索来源');
  source.columns = [{ width: 20 }, { width: 100 }];
  source.addRow(['结果来源与条件', String(context.source ?? '未提供')]);
  source.addRow(['导出时间', new Date().toISOString()]);
  source.addRow(['数据说明', '销量线索可能为订单数或 bookedCount，不能直接等同于售出件数；未提供统计周期时请勿推断。']);
  source.addRow(['图片说明', '单元格图片需新版 Excel 支持；图片链接保留在商品表。']);
  if (context.dedupeOfferIds) source.addRow(['去重说明', `按商品编号去重，重复编号保留首条；无编号的记录保留。原 ${originalCount} 条，导出 ${rows.length} 条。`]);
  let missingImages = 0;
  const cellImages = [];
  // Limit concurrent image requests to avoid flooding the image host.
  for (let start = 0; start < rows.length; start += 5) {
    const batch = rows.slice(start, start + 5);
    const images = await Promise.all(batch.map((row) => imageLoader(row[9])));
    for (let i = 0; i < batch.length; i++) {
      const row = sheet.addRow(columns.map((index) => String(batch[i][index] ?? '')));
      row.height = 75;
      row.alignment = { vertical: 'middle', wrapText: true };
      for (const originalIndex of [9, 10]) {
        const columnIndex = columns.indexOf(originalIndex);
        if (columnIndex < 0) continue;
        const value = String(batch[i][originalIndex] ?? '');
        try {
          const url = new URL(value);
          if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) {
            const cell = row.getCell(columnIndex + 1);
            cell.value = { text: value, hyperlink: value };
            cell.font = { color: { argb: 'FF0563C1' }, underline: true };
          }
        } catch { /* Keep non-URL values as plain text. */ }
      }
      if (images[i]) {
        row.getCell(1).value = '图片';
        cellImages.push({ ...images[i], row: row.number });
      } else if (batch[i][9]) {
        missingImages++;
        row.getCell(1).value = '图片加载失败';
      } else {
        row.getCell(1).value = '暂无图片';
      }
    }
  }
  return { buffer: await embedCellImages(Buffer.from(await workbook.xlsx.writeBuffer()), cellImages), missingImages, exportedCount: rows.length };
}
