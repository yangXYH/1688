import JSZip from 'jszip';

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Excel's in-cell pictures use rich values, rather than drawing anchors.
export async function embedCellImages(buffer, images) {
  if (!images.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name) => zip.file(name).async('string');
  const addBeforeEnd = (xml, end, value) => xml.replace(end, value + end);
  let sheet = await read('xl/worksheets/sheet1.xml');
  images.forEach(({ row }, i) => {
    const cell = new RegExp(`<c r="A${row}"([^>]*)>[\\s\\S]*?</c>`);
    if (!cell.test(sheet)) throw new Error(`找不到图片单元格 A${row}。`);
    sheet = sheet.replace(cell, (_, attrs) => `<c r="A${row}"${attrs.replace(/ t="[^"]*"/g, '')} t="e" vm="${i + 1}"><v>#VALUE!</v></c>`);
  });
  zip.file('xl/worksheets/sheet1.xml', sheet);
  let types = await read('[Content_Types].xml');
  const extensions = new Set(images.map((image) => image.extension === 'jpeg' ? 'jpeg' : 'png'));
  for (const ext of extensions) {
    if (!types.includes(`Extension="${ext}"`)) types = addBeforeEnd(types, '</Types>', `<Default Extension="${ext}" ContentType="image/${ext}"/>`);
  }
  for (const [part, type] of [
    ['metadata.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml'],
    ['richData/rdRichValueTypes.xml', 'application/vnd.ms-excel.rdrichvaluetypes+xml'],
    ['richData/rdrichvalue.xml', 'application/vnd.ms-excel.rdrichvalue+xml'],
    ['richData/rdrichvaluestructure.xml', 'application/vnd.ms-excel.rdrichvaluestructure+xml'],
    ['richData/richValueRel.xml', 'application/vnd.ms-excel.richvaluerel+xml'],
  ]) types = addBeforeEnd(types, '</Types>', `<Override PartName="/xl/${part}" ContentType="${type}"/>`);
  zip.file('[Content_Types].xml', types);
  let rels = await read('xl/_rels/workbook.xml.rels');
  let id = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])));
  for (const [type, target] of [
    [`${officeNs}/sheetMetadata`, 'metadata.xml'],
    ['http://schemas.microsoft.com/office/2022/10/relationships/richValueRel', 'richData/richValueRel.xml'],
    ['http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue', 'richData/rdrichvalue.xml'],
    ['http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure', 'richData/rdrichvaluestructure.xml'],
    ['http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes', 'richData/rdRichValueTypes.xml'],
  ]) rels = addBeforeEnd(rels, '</Relationships>', `<Relationship Id="rId${++id}" Type="${type}" Target="${target}"/>`);
  zip.file('xl/_rels/workbook.xml.rels', rels);
  const count = images.length;
  zip.file('xl/metadata.xml', `${declaration}<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="${count}">${images.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join('')}</futureMetadata><valueMetadata count="${count}">${images.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join('')}</valueMetadata></metadata>`);
  zip.file('xl/richData/rdrichvalue.xml', `${declaration}<rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="${count}">${images.map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join('')}</rvData>`);
  zip.file('xl/richData/rdrichvaluestructure.xml', `${declaration}<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`);
  zip.file('xl/richData/rdRichValueTypes.xml', `${declaration}<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags>${['_Self', '_DisplayString', '_Flags', '_Format', '_SubLabel', '_Attribution', '_Icon', '_Display', '_CanonicalPropertyNames', '_ClassificationId'].map((name) => `<key name="${name}">${name === '_Self' ? '<flag name="ExcludeFromFile" value="1"/>' : ''}<flag name="ExcludeFromCalcComparison" value="1"/></key>`).join('')}</keyFlags></global></rvTypesInfo>`);
  zip.file('xl/richData/richValueRel.xml', `${declaration}<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${officeNs}">${images.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join('')}</richValueRels>`);
  zip.file('xl/richData/_rels/richValueRel.xml.rels', `${declaration}<Relationships xmlns="${packageNs}">${images.map((image, i) => `<Relationship Id="rId${i + 1}" Type="${officeNs}/image" Target="../media/image${i + 1}.${image.extension}"/>`).join('')}</Relationships>`);
  images.forEach((image, i) => zip.file(`xl/media/image${i + 1}.${image.extension}`, image.buffer));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
