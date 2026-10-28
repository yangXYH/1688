import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createProductWorkbook } from '../scripts/web-export.mjs';

describe('workbench Excel export', () => {
  it('embeds product images in the first column with Chinese headers and reports failures', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF+8AAAAASUVORK5CYII=', 'base64');
    const rows = [
      ['', '123', '商品一', '10', '供应商', '浙江', '杭州', '100单', '20%', 'https://example.com/1.png', 'https://detail.1688.com/offer/123.html', 'bookedCount', '上游未提供统计周期'],
      ['', '456', '商品二', '20', '', '', '', '', '', 'https://example.com/missing.png', '', '上游未提供', '上游未提供统计周期'],
    ];
    const result = await createProductWorkbook(rows, async (url: string) => url.endsWith('/1.png') ? { buffer: png, extension: 'png' } : null, { source: '上一次成功搜索；关键词「保温杯」 · 价格 10–50 元' });
    expect(result.missingImages).toBe(1);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('商品')!;
    expect(sheet.getRow(1).values).toEqual([, '图片', '商品编号', '商品标题', '价格', '供应商', '省份', '城市', '销量线索', '复购率', '图片链接', '商品链接', '销量线索来源', '统计周期']);
    expect(sheet.getCell('L2').value).toBe('bookedCount');
    expect(sheet.getCell('M2').value).toBe('上游未提供统计周期');
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
});
