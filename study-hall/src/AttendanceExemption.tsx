export function validExemption(value: string) {
  return (
    !value ||
    value === "면접고사" ||
    (value.startsWith("기타: ") && !!value.slice(4).trim())
  );
}
export function AttendanceExemption({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const mode = !value ? "" : value === "면접고사" ? "면접고사" : "기타";
  return (
    <div className="attendance-exemption">
      <label className="field">
        <span>인정결석 집계 기준</span>
        <select
          aria-label="인정결석 집계 기준"
          value={mode}
          onChange={(e) =>
            onChange(e.target.value === "기타" ? "기타: " : e.target.value)
          }
        >
          <option value="">퇴출 집계에 포함</option>
          <option value="면접고사">면접고사 · 퇴출 집계 제외</option>
          <option value="기타">기타 사유 · 직접 입력 후 집계 제외</option>
        </select>
      </label>
      {mode === "기타" && (
        <label className="field">
          <span>집계 제외 사유 (필수)</span>
          <input
            aria-label="집계 제외 사유"
            maxLength={190}
            value={value.startsWith("기타: ") ? value.slice(4) : value}
            onChange={(e) => onChange("기타: " + e.target.value)}
            placeholder="집계에서 제외하는 사유를 입력하세요"
          />
        </label>
      )}
    </div>
  );
}
