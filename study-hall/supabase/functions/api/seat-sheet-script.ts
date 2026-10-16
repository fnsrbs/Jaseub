// Admin-only setup replaces the placeholder with the Vault-held signing secret.
export const seatSheetScript = String.raw`const JASEUB_SECRET = "__SHARED_SECRET__";
const JASEUB_SPREADSHEET = "__SPREADSHEET_ID__";
const JASEUB_SEAT_SHEET = __SEAT_SHEET_ID__;

function doPost(e) {
  var lock, locked = false;
  try {
    var envelope = JSON.parse(e.postData.contents);
    if (typeof envelope.payload !== "string" || envelope.payload.length > 100000 || !/^[a-f0-9]{64}$/.test(envelope.signature || "")) throw new Error("인증 오류");
    var bytes = Utilities.computeHmacSha256Signature(envelope.payload, JASEUB_SECRET, Utilities.Charset.UTF_8);
    var expected = bytes.map(function(b) { return ((b + 256) % 256).toString(16).padStart(2,"0"); }).join("");
    var diff = 0;
    for (var i = 0; i < 64; i++) diff |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (diff !== 0) throw new Error("인증 오류");
    var data = JSON.parse(envelope.payload);
    if (data.spreadsheetId !== JASEUB_SPREADSHEET || !Number.isFinite(data.issuedAt) || Math.abs(Date.now() - data.issuedAt) > 300000 || !/^[a-f0-9-]{36}$/.test(data.requestId || "")) throw new Error("요청 확인 필요");
    if (data.action !== "check" && data.action !== "sync" && data.action !== "roster" && data.action !== "attendance") throw new Error("지원하지 않는 요청");
    lock = LockService.getScriptLock(); lock.waitLock(20000); locked = true;
    if (data.action === "attendance") return jaseubAttendance(data.attendance);
    if (data.action === "roster") {
      var roster = SpreadsheetApp.openById(JASEUB_SPREADSHEET).getSheetByName("출석부(확정)");
      if (!roster) throw new Error("출석부(확정) 시트를 찾을 수 없습니다.");
      var values = roster.getRange(5,1,996,3).getDisplayValues();
      if (values[0][1] !== "학번" || values[0][2] !== "이름") throw new Error("출석부 학번·이름 열을 확인하세요.");
      var students = [], numbers = {};
      values.slice(1).forEach(function(row) {
        var number = String(row[1] || "").trim(), name = String(row[2] || "").trim();
        if (!number && !name) return;
        if (!/^\d{5}$/.test(number) || !name || name.length > 80 || numbers[number]) throw new Error("출석부의 빈 이름·잘못된 학번·중복 학번을 확인하세요.");
        numbers[number] = true; students.push({number:number,name:name});
      });
      if (!students.length) throw new Error("출석부에 학생이 없습니다.");
      return jaseubJson({ok:true,students:students});
    }
    var sheet = SpreadsheetApp.openById(JASEUB_SPREADSHEET).getSheets().filter(function(s) { return s.getSheetId() === JASEUB_SEAT_SHEET; })[0];
    if (!sheet) throw new Error("좌석배치 시트를 찾을 수 없습니다.");
    var labels = sheet.getRange(1,1,40,23).getDisplayValues();
    var positions = {};
    labels.forEach(function(row,r) { row.forEach(function(value,c) {
      var m = String(value).trim().match(/^([1-9][0-9]?)번$/);
      if (!m || +m[1] > 72) return;
      if (positions[m[1]]) throw new Error("좌석번호 중복");
      positions[m[1]] = { row: r+2, col: c+1 };
    }); });
    if (Object.keys(positions).length !== 72) throw new Error("좌석표 구조가 달라졌습니다. 1~72번을 확인하세요.");
    if (data.action === "check") return jaseubJson({ ok:true, ready:true, seats:72, attendance:true });
    if (!Array.isArray(data.seats) || data.seats.length !== 72) throw new Error("좌석 데이터 확인 필요");
    var seen = {}, changes = [], before = [];
    data.seats.forEach(function(s) {
      if (!Number.isInteger(s.id) || s.id < 1 || s.id > 72 || seen[s.id] || typeof s.number !== "string" || typeof s.name !== "string" || s.number.length > 40 || s.name.length > 80 || (!!s.number !== !!s.name)) throw new Error("좌석 데이터 확인 필요");
      seen[s.id] = true;
      var pos = positions[s.id], range = sheet.getRange(pos.row,pos.col);
      if (range.isPartOfMerge()) throw new Error("좌석 이름 칸의 병합을 확인하세요.");
      before.push({ seat_id:s.id, row:pos.row, col:pos.col, formula:range.getFormula(), value:range.getValue() });
      changes.push({ range:range, text:s.number ? s.number + "\n" + s.name : "" });
    });
    var cache = CacheService.getScriptCache(), key = "jaseub-seat-" + data.requestId;
    if (cache.get(key)) throw new Error("이미 처리된 요청입니다. 시트를 확인하세요.");
    try {
      // A rich-text value is always literal, including a student name starting '='.
      changes.forEach(function(c) { c.range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(c.text).build()); });
      SpreadsheetApp.flush();
    } catch(writeError) {
      before.forEach(function(b) {
        var range = sheet.getRange(b.row,b.col);
        if (b.formula) range.setFormula(b.formula);
        else if (typeof b.value === "string") range.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(b.value).build());
        else range.setValue(b.value);
      });
      SpreadsheetApp.flush();
      throw new Error("반영 중 오류로 기존 값을 복구했습니다.");
    }
    cache.put(key,"done",600);
    return jaseubJson({ ok:true, updated:72, before:before });
  } catch(error) {
    return jaseubJson({ ok:false, error:String(error.message || "구글 시트 반영 실패") });
  } finally { if (locked) lock.releaseLock(); }
}
function jaseubJson(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function jaseubAttendance(data) {
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data.day || "") || !Number.isSafeInteger(data.generation) || data.generation < 1 || !Array.isArray(data.rows) || data.rows.length > 1000) throw new Error("출석 데이터 확인 필요");
  var seen = {};
  data.rows.forEach(function(row) {
    if (typeof row.number !== "string" || !row.number || row.number.length > 40 || seen[row.number] || typeof row.name !== "string" || row.name.length > 80 || typeof row.note !== "string" || row.note.length > 4000 || !Array.isArray(row.statuses) || row.statuses.length !== 7 || row.statuses.some(function(s) { return ["", "출석", "지각", "결석", "인정결석", "—"].indexOf(s) < 0; })) throw new Error("출석 학생·상태를 확인하세요.");
    seen[row.number] = true;
  });
  var properties = PropertiesService.getScriptProperties(), key = "attendance-generation-" + data.day;
  var previousGeneration = Number(properties.getProperty(key) || "0");
  if (data.generation < previousGeneration) throw new Error("더 최신 출석이 시트에 있습니다. 다시 조회한 뒤 반영하세요.");
  var book = SpreadsheetApp.openById(JASEUB_SPREADSHEET), name = "교시별출석_" + data.day.slice(0,7);
  var sheet = book.getSheetByName(name);
  var headers = ["날짜","학번","이름","1교시","2교시","3교시","4교시","5교시","6교시","7교시","사유·메모","최종 반영 시각"];
  if (!sheet) sheet = book.insertSheet(name);
  var last = sheet.getLastRow();
  if (last > 10001) throw new Error("출석 시트 행 수가 예상 범위를 넘었습니다.");
  if (last && JSON.stringify(sheet.getRange(1,1,1,12).getDisplayValues()[0]) !== JSON.stringify(headers)) throw new Error("동일 이름 시트의 열 구조가 다릅니다. 기존 시트를 확인하세요.");
  var previous = last > 1 ? sheet.getRange(2,1,last-1,12).getDisplayValues() : [];
  var updatedAt = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var rows = previous.filter(function(row) { return row[0] !== data.day; });
  data.rows.forEach(function(row) { rows.push([data.day,row.number,row.name].concat(row.statuses).concat([row.note,updatedAt])); });
  rows.sort(function(a,b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]), "ko", { numeric:true }); });
  var literal = function(value) { var text = String(value == null ? "" : value); return /^[=+@-]/.test(text) ? "'" + text : text; };
  var values = [headers].concat(rows.map(function(row) { return row.map(literal); }));
  var neededRows = Math.max(values.length, last, 2);
  if (sheet.getMaxRows() < neededRows) sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  var range = sheet.getRange(1,1,neededRows,12);
  var backup = last ? sheet.getRange(1,1,last,12).getDisplayValues() : [];
  try {
    range.clearContent();
    sheet.getRange(1,1,values.length,12).setNumberFormat("@").setValues(values);
    sheet.setFrozenRows(1); sheet.setFrozenColumns(3);
    sheet.getRange(1,1,1,12).setBackground("#176b58").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setColumnWidths(1,3,100); sheet.setColumnWidths(4,7,65); sheet.setColumnWidth(11,280); sheet.setColumnWidth(12,160);
    if (rows.length) sheet.getRange(2,1,rows.length,12).setWrap(true).setVerticalAlignment("middle");
    SpreadsheetApp.flush();
    properties.setProperty(key,String(data.generation));
  } catch (error) {
    range.clearContent();
    if (backup.length) sheet.getRange(1,1,backup.length,12).setNumberFormat("@").setValues(backup.map(function(row) { return row.map(literal); }));
    SpreadsheetApp.flush();
    throw new Error("출석 시트 반영 중 오류가 발생해 이전 값을 복구했습니다.");
  }
  return jaseubJson({ok:true,updated:data.rows.length,url:book.getUrl()+"#gid="+sheet.getSheetId()});
}
`;
