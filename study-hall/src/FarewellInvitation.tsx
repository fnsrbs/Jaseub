export function FarewellInvitation({
  name,
  read,
}: {
  name: string;
  read: () => void;
}) {
  return (
    <section className="farewell-invitation">
      <p className="farewell-invitation-eyebrow">온실에서 편지가 도착했어요</p>
      <div className="farewell-envelope" aria-hidden="true">
        <span>🍀</span>
      </div>
      <p className="farewell-invitation-recipient">{name} 님에게</p>
      <h2 id="farewell-title" tabIndex={-1}>
        너에게 도착한
        <br />
        마지막 편지
      </h2>
      <p className="farewell-invitation-description">
        함께 쌓아온 시간과
        <br />
        너를 위한 응원을 담았어.
      </p>
      <button
        type="button"
        className="primary farewell-read-button"
        onClick={read}
      >
        마지막 편지 읽기 <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
