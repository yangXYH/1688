import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createProductWorkbook } from '../scripts/web-export.mjs';

describe('workbench Excel export', () => {
  it('optionally keeps the first row for each offer ID and retains rows without IDs', async () => {
    const rows = [
      ['', '1', '商品一', '', '甲', '', '', '', '', 'https://example.com/a.jpg', 'https://detail.1688.com/offer/1.html', '', ''],
      ['', '1', '商品二', '', '乙', '', '', '', '', 'https://example.com/a.jpg', 'https://detail.1688.com/offer/1.html', '', ''],
      ['', '', '商品三', '', '丙', '', '', '', '', '', 'https://detail.1688.com/offer/3.html', '', ''],
      ['', '', '商品四', '', '丁', '', '', '', '', '', 'https://detail.1688.com/offer/4.html', '', ''],
      ['', '2', '其他商品', '', '戊', '', '', '', '', 'https://example.com/a.jpg', 'https://detail.1688.com/offer/2.html', '', ''],
    ];
    const result = await createProductWorkbook(rows, async () => null, { dedupeOfferIds: true });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    expect(result.exportedCount).toBe(4);
    expect(workbook.getWorksheet('商品')!.rowCount).toBe(5);
    expect(workbook.getWorksheet('商品')!.getCell('C2').value).toBe('商品一');
    expect(workbook.getWorksheet('搜索来源')!.getCell('B5').value).toContain('原 5 条，导出 4 条');
    const ungrouped = await createProductWorkbook(rows, async () => null);
    const plainWorkbook = new ExcelJS.Workbook();
    await plainWorkbook.xlsx.load(ungrouped.buffer);
    expect(plainWorkbook.getWorksheet('商品')!.rowCount).toBe(6);
  });
  it('embeds product images in the first column with Chinese headers and reports failures', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF+8AAAAASUVORK5CYII=', 'base64');
    const rows = [
      ['', '123', '商品一', '10', '供应商', '浙江', '杭州', '100单', '', 'https://example.com/1.png', 'https://detail.1688.com/offer/123.html', 'bookedCount', '上游未提供统计周期'],
      ['', '456', '商品二', '20', '', '', '', '', '', 'https://example.com/missing.png', '', '上游未提供', '上游未提供统计周期'],
    ];
    const result = await createProductWorkbook(rows, async (url: string) => url.endsWith('/1.png') ? { buffer: png, extension: 'png' } : null, { source: '上一次成功搜索；关键词「保温杯」 · 价格 10–50 元' });
    expect(result.missingImages).toBe(1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('商品')!;
    expect(sheet.getRow(1).values).toEqual([, '图片', '商品编号', '商品标题', '价格', '供应商', '省份', '城市', '销量线索', '图片链接', '商品链接', '销量线索来源']);
    expect(sheet.getCell('K2').value).toBe('bookedCount');
    expect(sheet.getCell('I2').value).toEqual({ text: 'https://example.com/1.png', hyperlink: 'https://example.com/1.png' });
    expect(sheet.getCell('J2').value).toEqual({ text: 'https://detail.1688.com/offer/123.html', hyperlink: 'https://detail.1688.com/offer/123.html' });
    expect(workbook.getWorksheet('搜索来源')!.getCell('B1').value).toContain('上一次成功搜索；关键词「保温杯」');
    expect(sheet.getCell('B2').value).toBe('123');
    expect(sheet.getCell('A3').value).toBe('图片加载失败');
    expect(sheet.getImages()).toHaveLength(0);
    const zip = await JSZip.loadAsync(result.buffer);
    const worksheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(worksheetXml).toMatch(/<c r="A2"[^>]*t="e" vm="1"><v>#VALUE!<\/v><\/c>/);
    expect(await zip.file('xl/richData/rdrichvaluestructure.xml')!.async('string')).toContain('_localImage');
    expect(await zip.file('xl/richData/_rels/richValueRel.xml.rels')!.async('string')).toContain('../media/image1.png');
    expect(await zip.file('xl/media/image1.png')!.async('nodebuffer')).toEqual(png);
  });

  it('omits empty and unknown-only fields while preserving partial data and real zeros', async () => {
    const rows = [
      ['', '123', '商品一', '10', '供应商', '浙江', '杭州', '0', '', '', 'https://detail.1688.com/offer/123.html', 'bookedCount', '上游未提供统计周期'],
      ['', '456', '商品二', '20', '', '', '', '暂无销量线索', '  ', '', 'https://detail.1688.com/offer/456.html', 'bookedCount', '上游未提供统计周期'],
    ];
    const result = await createProductWorkbook(rows, async () => null);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('商品')!;
    expect(sheet.getRow(1).values).toEqual([, '图片', '商品编号', '商品标题', '价格', '供应商', '省份', '城市', '销量线索', '商品链接', '销量线索来源']);
    expect(sheet.getCell('F2').value).toBe('浙江');
    expect(sheet.getCell('H2').value).toBe('0');
    expect(sheet.getCell('I3').value).toEqual({ text: 'https://detail.1688.com/offer/456.html', hyperlink: 'https://detail.1688.com/offer/456.html' });
    expect(sheet.getColumn(9).width).toBe(50);
    expect(sheet.getColumn(10).width).toBe(60);
  });

  it('keeps a period or repurchase column when any row supplies a value', async () => {
    const result = await createProductWorkbook([
      ['', '123', '商品', '', '', '', '', '', '0%', '', '', '', '近30天'],
      ['', '456', '商品二', '', '', '', '', '', '', '', '', '', '上游未提供统计周期'],
    ], async () => null);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    expect(workbook.getWorksheet('商品')!.getRow(1).values).toEqual([, '图片', '商品编号', '商品标题', '复购率', '统计周期']);
    expect(workbook.getWorksheet('商品')!.getCell('D2').value).toBe('0%');
    expect(workbook.getWorksheet('商品')!.getCell('E2').value).toBe('近30天');
  });
});
