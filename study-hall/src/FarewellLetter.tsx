import { duration } from "./domain";

export function FarewellLetter({
  name,
  seconds,
  days,
  clovers,
  awards,
  awardsError,
  retry,
}: {
  name: string;
  seconds: number;
  days: number;
  clovers: number;
  awards: { crowns: number; stars: number } | null;
  awardsError: boolean;
  retry: () => void;
}) {
  return (
    <article className="farewell-letter">
      <div className="farewell-clover" aria-hidden="true">
        🍀
      </div>
      <p className="farewell-eyebrow">
        온실에서 보내는 마지막 편지 · 2026. 11. 17.
      </p>
      <h2 id="farewell-title">
        쌓아온 시간,
        <br />
        빛날 너의 내일
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
        <p>
          여기 기록된 시간은
          <br />
          네가 해온 노력의 일부일 뿐이야.
        </p>
        <p>
          초등학교에 입학한 날부터 지금까지,
          <br />
          교실에서, 집에서, 혼자 책상 앞에서
          <br />
          보낸 12년의 시간은
          <br />
          숫자 하나에 다 담을 수 없으니까.
        </p>
        <p>
          잘해낸 날도, 마음처럼 되지 않았던 날도
          <br />
          너는 배우고 자라며 여기까지 왔어.
        </p>
        <p>
          시험 날에는 쌓아온 너의 힘을 믿고,
          <br />한 문제씩 차분하게 풀고 와.
        </p>
        <p>
          하루하루 모은 클로버가
          <br />
          시험 날에는 행운으로 돌아오길.
        </p>
        <p className="farewell-wish">너의 합격을 진심으로 응원해.</p>
      </div>

      <div
        className="farewell-medal"
        aria-label="완주 훈장: 끝까지 걸어온 너에게"
      >
        <span className="farewell-medal-icon" aria-hidden="true">
          🏅
        </span>
        <div>
          <small>온실 완주 훈장</small>
          <h3>끝까지 걸어온 너에게</h3>
          <p>오랜 시간 애써온 너에게 이 훈장을 보냅니다.</p>
        </div>
      </div>
      <p className="farewell-signature">너의 다음 계절도 응원하며, 온실</p>
    </article>
  );
}
