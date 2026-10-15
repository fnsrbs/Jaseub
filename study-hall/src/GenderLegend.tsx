export function GenderLegend() {
  return (
    <div className="gender-legend" aria-label="좌석 성별 색상 범례">
      <span>
        <i className="gender-swatch male" />
        남학생 · 파랑
      </span>
      <span>
        <i className="gender-swatch female" />
        여학생 · 분홍
      </span>
      <span>
        <i className="gender-swatch" />
        미확인 · 빈 좌석
      </span>
    </div>
  );
}
