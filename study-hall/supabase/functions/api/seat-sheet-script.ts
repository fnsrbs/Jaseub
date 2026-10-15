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
    if (data.action !== "check" && data.action !== "sync") throw new Error("지원하지 않는 요청");
    lock = LockService.getScriptLock(); lock.waitLock(20000); locked = true;
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
    if (data.action === "check") return jaseubJson({ ok:true, ready:true, seats:72 });
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
`;
