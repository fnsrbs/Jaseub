import { duration } from "./domain";
import { defaultFarewellCopy, type FarewellCopy } from "./farewell-copy";

export function FarewellLetter({
  name,
  seconds,
  days,
  clovers,
  awards,
  awardsError,
  retry,
  copy = defaultFarewellCopy,
  titleId = "farewell-title",
}: {
  name: string;
  seconds: number;
  days: number;
  clovers: number;
  awards: { crowns: number; stars: number } | null;
  awardsError: boolean;
  retry: () => void;
  copy?: FarewellCopy;
  titleId?: string;
}) {
  return (
    <article className="farewell-letter">
      <div className="farewell-clover" aria-hidden="true">
        🍀
      </div>
      <p className="farewell-eyebrow">
        {copy.farewell_eyebrow} · {copy.farewell_date.replaceAll("-", ". ")}.
      </p>
      <h2 id={titleId} tabIndex={-1}>
        {copy.farewell_title}
      </h2>
      <p className="farewell-recipient">{name} 님에게</p>

      <div className="farewell-records" aria-label="나의 자습실 기록">
        <div>
          <span>차곡차곡 쌓은 시간</span>
          <strong>{duration(seconds)}</strong>
        </div>
        <div>
          <span>온실에서 함께한 날</span>
          <strong>{days}일</strong>
        </div>
      </div>
      <p className="farewell-record-note">
        자습실 출결 기록 기준 · 퇴실이 완료된 이용 시간과 일수
      </p>
      <div className="farewell-collections" aria-label="모아온 수집 기록">
        <span>
          🍀 클로버 <b>{clovers}개</b>
        </span>
        {awards ? (
          <>
            <span>
              👑 왕관 <b>{awards.crowns}개</b>
            </span>
            <span>
              ⭐ 별 <b>{awards.stars}개</b>
            </span>
          </>
        ) : awardsError ? (
          <button type="button" onClick={retry}>
            왕관·별 기록 다시 불러오기
          </button>
        ) : (
          <span role="status">왕관·별 기록을 불러오는 중…</span>
        )}
      </div>

      <div className="farewell-message">
        {copy.farewell_body.split(/\n\s*\n/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        <p className="farewell-wish">{copy.farewell_wish}</p>
      </div>

      <div
        className="farewell-medal"
        aria-label={`완주 훈장: ${copy.farewell_medal_title}`}
      >
        <span className="farewell-medal-icon" aria-hidden="true">
          🥇
        </span>
        <div>
          <small>{copy.farewell_medal_label}</small>
          <h3>{copy.farewell_medal_title}</h3>
          <p>{copy.farewell_medal_body}</p>
        </div>
      </div>
      <p className="farewell-signature">{copy.farewell_signature}</p>
    </article>
  );
}
