import { ManualAttendance } from "./ManualAttendance";
import { AttendanceSummary } from "./AttendanceSummary";
import { CheckoutGuide, CameraGuide } from "./AttendanceGuide";
import { pollWhileVisible } from "./visible-polling";
import React, { useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { api, mode, supabase } from "./api";
import {
  attendanceVerdict,
  csv,
  csvTime,
  dailyUsage,
  dayStart,
  duration,
  koreanDay,
  lottery,
  totals,
  validQr,
  type Snapshot,
  type Student,
  type Visit,
  type Notice,
} from "./domain";
import "./style.css";
import { SeatPicker } from "./SeatPicker";
import { deferredPanel } from "./deferred-panel";
const SeatArrangement = deferredPanel(() =>
  import("./SeatArrangement").then((m) => ({ default: m.SeatArrangement })),
);
const SeatPrint = deferredPanel(() =>
  import("./SeatPrint").then((m) => ({ default: m.SeatPrint })),
);
const SeatSheetSync = deferredPanel(() =>
  import("./SeatSheetSync").then((m) => ({ default: m.SeatSheetSync })),
);
import { GenderLegend } from "./GenderLegend";
import { WarningCards } from "./WarningCards";
import { StudentWarningIssue } from "./StudentWarningIssue";
const PeriodAttendance = deferredPanel(() =>
  import("./PeriodAttendance").then((m) => ({ default: m.PeriodAttendance })),
);
import { StudentLookup } from "./StudentLookup";
const Supervision = deferredPanel(() =>
  import("./Supervision").then((m) => ({ default: m.Supervision })),
);
const Cleaning = deferredPanel(() =>
  import("./Cleaning").then((m) => ({ default: m.Cleaning })),
);
import { WeeklyRanking } from "./WeeklyRanking";
import { HomeCollectedRecords } from "./CollectedRecords";
import { rememberedLogin, rememberLogin } from "./remembered-login";
import { orderedMenu, cachedMenuOrders, cacheMenuOrders } from "./menu-order";
import { MenuOrderEditor, type MenuConfig } from "./MenuOrderEditor";
import { pairLottery, validateDeskPairs } from "./seat-pairs";
import {
  defaultSiteCopy,
  cachedSiteCopy,
  cacheSiteCopy,
  type SiteCopy,
} from "./site-copy";
type Role = "teacher" | "student" | "viewer";
const time = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "진행 중";
const localInput = (s: string) =>
  new Date(Date.parse(s) + 9 * 3600000).toISOString().slice(0, 16);
const isoInput = (s: string) => new Date(`${s}:00+09:00`).toISOString();
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export default function App() {
  const [role, setRole] = useState<Role | null>(
      () => sessionStorage.getItem("sh-role") as Role | null,
    ),
    [token, setToken] = useState<string | null>(() =>
      sessionStorage.getItem("sh-token"),
    ),
    [data, setData] = useState<Snapshot | null>(null),
    [page, setPage] = useState(location.hash.slice(1) || "home"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [scan, setScan] = useState<"in" | "out" | null>(null),
    [selected, setSelected] = useState("");
  const inFlight = useRef(false);
  const [detailStudent, setDetailStudent] = useState("");
  const [menuOrders, setMenuOrders] = useState(() => cachedMenuOrders(mode));
  const [menuConfig, setMenuConfig] = useState<MenuConfig | null>(null);
  const updateMenuConfig = (next: MenuConfig) => {
    setMenuConfig(next);
    setMenuOrders(next.orders);
    cacheMenuOrders(mode, next.orders);
  };
  useEffect(() => {
    if (!role) return;
    let alive = true;
    const load = async () => {
      try {
        const next = await api("menu_order", {}, role, token);
        if (alive) updateMenuConfig(next);
      } catch {}
    };
    const stopPolling = pollWhileVisible(load, 300000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [role, token]);
  const [initialCopy] = useState(() => cachedSiteCopy(mode));
  const [copy, setCopy] = useState<SiteCopy>(initialCopy || defaultSiteCopy);
  const [copyReady, setCopyReady] = useState(mode === "demo" || !!initialCopy);
  const updateCopy = (next: SiteCopy) => {
    const merged = { ...defaultSiteCopy, ...next };
    setCopy(merged);
    cacheSiteCopy(mode, merged);
    setCopyReady(true);
  };
  useEffect(() => {
    let alive = true;
    void api("public_copy")
      .then((next) => {
        if (alive) updateCopy(next);
      })
      .catch(() => {
        if (!alive) return;
        if (!initialCopy && mode !== "demo")
          setCopy({
            ...defaultSiteCopy,
            hero_eyebrow: "",
            hero_title: "용인고 온실",
            hero_description: "",
          });
        setCopyReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!data?.settings.site_copy) return;
    const next = { ...defaultSiteCopy, ...data.settings.site_copy };
    if (
      (Object.keys(defaultSiteCopy) as (keyof SiteCopy)[]).some(
        (key) => copy[key] !== next[key],
      )
    )
      updateCopy(next);
  }, [data?.settings.site_copy]);
  const admin = role === "teacher";
  const teacher = admin || role === "viewer";
  const navigate = (p: string) => {
    location.hash = p;
    setPage(p);
  };
  const refresh = async () => {
    const next = await api("snapshot", {}, role, token);
    setOffset(Date.parse(next.server_now) - Date.now());
    setData(next);
  };
  useEffect(() => {
    const h = () => setPage(location.hash.slice(1) || "home");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  useEffect(() => {
    if (!role) return;
    let alive = true;
    const load = async () => {
      try {
        await refresh();
        if (alive) setError("");
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const stopPolling = pollWhileVisible(load, 15000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [role, token]);
  useEffect(() => {
    return pollWhileVisible(() => setNow(Date.now()), 10000);
  }, []);
  async function act(action: string, payload: any) {
    if (inFlight.current) throw Error("이전 요청을 처리하고 있습니다.");
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api(action, payload, role, token);
      setMessage(
        action === "student_code" || action === "teacher_code"
          ? "코드 조회 완료"
          : mode === "demo"
            ? "데모 저장 완료 · 가상 데이터"
            : "DB 저장 완료",
      );
      try {
        await refresh();
      } catch {
        setError(
          "저장은 완료됐지만 화면 갱신에 실패했습니다. 다시 조회하세요.",
        );
      }
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const safe = (promise: Promise<unknown>) => {
    void promise.catch(() => {});
  };
  async function logout() {
    try {
      if (role === "student" || role === "viewer")
        await api("logout", {}, role, token);
      else if (supabase) await supabase.auth.signOut();
    } catch {}
    sessionStorage.removeItem("sh-role");
    sessionStorage.removeItem("sh-token");
    setRole(null);
    setToken(null);
    setData(null);
    setError("");
    setMessage("");
    navigate("home");
  }
  async function login(
    r: Role,
    code: string,
    email: string,
    password: string,
    remember = false,
  ) {
    setBusy(true);
    setError("");
    try {
      let t: null | string = null;
      if (r === "student" || r === "viewer") {
        const result = await api(r === "viewer" ? "teacher_login" : "login", {
          code,
        });
        t = result.token;
      } else if (mode === "production") {
        if (!supabase) throw Error("Supabase 환경 설정이 필요합니다.");
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        await api("snapshot", {}, r, null);
      }
      if (r === "student" || r === "viewer")
        rememberLogin(mode, r, code, remember);
      sessionStorage.setItem("sh-role", r);
      if (t) sessionStorage.setItem("sh-token", t);
      else sessionStorage.removeItem("sh-token");
      setToken(t);
      setRole(r);
      navigate("home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!role)
    return (
      <Login
        onLogin={login}
        busy={busy}
        error={error}
        copy={copy}
        copyReady={copyReady}
      />
    );
  const currentNow = now + offset;
  const today = koreanDay(new Date(currentNow));
  const me = data?.students[0];
  const active = data?.visits.find(
    (v) => v.student_id === me?.id && !v.exited_at,
  );
  const missing =
    data?.visits.filter(
      (v) =>
        !v.exited_at &&
        currentNow - Date.parse(v.entered_at) >
          data.settings.missing_hours * 3600000,
    ) || [];
  const menu = orderedMenu(role, menuOrders);
  return (
    <div className="layout">
      <aside>
        <a className="brand" href="#home">
          <b>◒</b>
          <span>
            온실<small>STUDY ROOM</small>
          </span>
        </a>
        <div className="role-label">
          {admin
            ? "ADMIN WORKSPACE"
            : teacher
              ? "TEACHER VIEW"
              : "MY STUDY SPACE"}
        </div>
        <nav>
          {menu.map(([p, icon, label]) => (
            <a href={"#" + p} key={p} className={page === p ? "active" : ""}>
              <span>{icon}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <small>차분하게, 꾸준하게 성장하는 공간</small>
        </div>
      </aside>
      <main>
        <header>
          <span>
            {admin
              ? "관리자 공간"
              : teacher
                ? "교사 공간 · 조회 및 경고카드 관리"
                : "학생 전용 공간"}
          </span>
          <div>
            <span className={"mode " + (mode === "demo" ? "demo" : "")}>
              {mode === "demo" ? "가상 데이터 · 데모" : copy.production_badge}
            </span>
            <button onClick={logout}>로그아웃</button>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <p className="eyebrow">
                {new Date(currentNow).toLocaleDateString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </p>
              <h1>{menu.find((m) => m[0] === page)?.[2] || "자습실"}</h1>
              <p>
                {page === "supervision"
                  ? "날짜와 교시별 감독 일정을 확인하세요."
                  : page === "cleaning"
                    ? "청소 날짜와 당번 순서를 확인하세요."
                    : page === "warnings"
                      ? teacher
                        ? "학생별 경고 내역을 확인하고 자습실 이용 규칙을 안내해 주세요."
                        : "경고 사유와 누적 횟수를 확인하고 자습실 이용 규칙을 지켜 주세요."
                      : teacher
                        ? "오늘의 학습 공간을 한눈에 살펴보세요."
                        : "오늘도 나만의 속도로 한 걸음 나아가요."}
              </p>
            </div>
            <div className="exam">
              수능까지{" "}
              <strong>
                {data?.settings.exam_date
                  ? (() => {
                      const d = Math.round(
                        (dayStart(data.settings.exam_date) - dayStart(today)) /
                          86400000,
                      );
                      return d === 0
                        ? "D-DAY"
                        : d > 0
                          ? "D−" + d
                          : "D+" + Math.abs(d);
                    })()
                  : "설정 필요"}
              </strong>
            </div>
          </div>
          {teacher && data && detailStudent && (
            <SeatStudentDetails
              act={act}
              busy={busy}
              data={data}
              studentId={detailStudent}
              now={currentNow}
              close={() => setDetailStudent("")}
            />
          )}
          {error && (
            <div role="alert" className="alert error">
              {error} <button onClick={() => safe(refresh())}>다시 조회</button>
            </div>
          )}
          {message && (
            <div role="status" className="alert success">
              {message}
            </div>
          )}
          {!data ? (
            <div className="panel">
              {error
                ? "데이터를 불러오지 못했습니다. 다시 조회하거나 로그아웃 후 로그인하세요."
                : "데이터를 불러오고 있습니다…"}
            </div>
          ) : (
            <>
              {page === "home" && (
                <>
                  <div
                    className={teacher ? "metrics" : "metrics student-metrics"}
                  >
                    {teacher ? (
                      <CurrentStudents data={data} />
                    ) : (
                      <Metric
                        label="현재 입실 인원"
                        value={`${data.current}`}
                        unit={`/ ${data.settings.capacity}명`}
                        caption="지금 자습실에서 공부하는 학생"
                      />
                    )}
                    <Metric
                      label="오늘 출석 인원"
                      value={`${data.today}`}
                      unit={`/ ${data.settings.capacity}명`}
                      caption="오늘 한 번 이상 입실한 학생"
                    />
                    <Metric
                      label={teacher ? "퇴실 확인 필요" : "나의 배정 좌석"}
                      value={
                        teacher
                          ? String(missing.length)
                          : String(me?.seat_id || "미배정")
                      }
                      unit={teacher ? "명" : "번"}
                      caption={
                        teacher
                          ? "설정된 확인 시간을 넘긴 이용 구간"
                          : "고정 좌석 · 좌석 배치도에서 확인"
                      }
                    />
                    {!teacher && (
                      <Metric
                        label="누적 경고카드"
                        value={String(
                          (data.warnings || []).filter(
                            (w) => w.student_id === me?.id && !w.deleted_at,
                          ).length,
                        )}
                        unit="회"
                        caption="삭제된 경고는 제외됩니다."
                      />
                    )}
                  </div>
                  {teacher ? (
                    <>
                      <div className="section-head">
                        <h2>자습실 현황</h2>
                        {admin && (
                          <a href="#qr" className="button primary">
                            현장 QR 표시 ↗
                          </a>
                        )}
                      </div>
                      <SeatMap
                        data={data}
                        teacher
                        selected={selected}
                        onSelect={(id) => {
                          setSelected(id);
                          if (
                            data.students.some(
                              (s) => s.id === id && !s.deleted_at,
                            )
                          )
                            setDetailStudent(id);
                        }}
                      />
                      <ManualAttendance data={data} act={act} busy={busy} />
                      {missing.length > 0 && (
                        <div className="alert error">
                          퇴실 확인 필요:{" "}
                          {missing
                            .map(
                              (v) =>
                                data.students.find((s) => s.id === v.student_id)
                                  ?.name,
                            )
                            .join(", ")}
                          . 출결 기록에서 실제 시각과 사유를 입력하세요.
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="panel welcome">
                        <div>
                          <span className="eyebrow">MY DAILY STUDY</span>
                          <h2>{me?.name} 님, 오늘도 파이팅!</h2>
                          <HomeCollectedRecords
                            clovers={data.clovers ?? 0}
                            visits={data.visits}
                            token={token}
                          />
                          <section
                            className="home-use-status"
                            aria-label="오늘의 이용 현황"
                          >
                            <h3>오늘의 이용 현황</h3>
                            <p>
                              <span>출입 상태</span>
                              <span className="home-use-value">
                                <span
                                  className={"status " + (active ? "in" : "")}
                                >
                                  {active ? "● 입실 중" : "○ 퇴실"}
                                </span>{" "}
                                {active &&
                                  (currentNow - Date.parse(active.entered_at) >
                                  data.settings.missing_hours * 3600000
                                    ? "퇴실 확인 필요"
                                    : `현재 이용 ${duration((currentNow - Date.parse(active.entered_at)) / 1000)}`)}
                              </span>
                            </p>
                            <p>
                              <span>오늘 출석</span>
                              <span className="home-use-value">
                                {attendanceVerdict(
                                  me!.id,
                                  data.operating_days.find(
                                    (d) => d.day === today,
                                  ),
                                  data.visits,
                                  currentNow,
                                )}
                              </span>
                            </p>
                          </section>
                        </div>
                        <div className="check-buttons">
                          <button
                            className="primary"
                            onClick={() => setScan("in")}
                            disabled={!!active || busy}
                          >
                            ▣ 입실 QR 찍기
                          </button>
                          <button
                            onClick={() => setScan("out")}
                            disabled={!active || busy}
                          >
                            ▣ 퇴실 QR 찍기
                          </button>
                          <small>
                            출결은 서버 저장이 완료된 후 반영됩니다.
                          </small>
                          <CheckoutGuide />
                          <CameraGuide />
                        </div>
                      </div>
                      <h2>오늘의 이용 시간</h2>
                      <Stats
                        data={data}
                        studentId={me!.id}
                        now={currentNow}
                        compact
                      />
                    </>
                  )}
                  <div className="section-head">
                    <h2>자습실 소식</h2>
                    <a href="#notices">모두 보기 →</a>
                  </div>
                  {data.notices.slice(0, 2).map((n) => (
                    <NoticeCard key={n.id} n={n} />
                  ))}
                  {!data.notices.length && (
                    <Empty text="등록된 공지가 없습니다." />
                  )}
                </>
              )}
              {page === "ranking" && (
                <WeeklyRanking
                  role={role}
                  token={token}
                  visits={data.visits}
                  encouragement={copy.ranking_encouragement}
                />
              )}
              {page === "attendance" && !teacher && (
                <AttendanceSummary
                  students={data.students}
                  studentId={me?.id}
                />
              )}
              {page === "attendance" && teacher && (
                <PeriodAttendance
                  data={data}
                  role={admin ? "teacher" : "viewer"}
                  token={token}
                  now={currentNow}
                />
              )}
              {page === "supervision" && teacher && (
                <Supervision
                  role={admin ? "teacher" : "viewer"}
                  token={token}
                  act={act}
                />
              )}
              {page === "cleaning" && (
                <Cleaning role={role} token={token} data={data} act={act} />
              )}
              {page === "qr" && admin && (
                <QRDisplay role={role} token={token} />
              )}
              {page === "seats" && (
                <>
                  {!admin && (
                    <SeatMap
                      data={data}
                      teacher={teacher}
                      selected={teacher ? selected : me?.id}
                      onSelect={setSelected}
                    />
                  )}
                  {admin && <SeatAdmin data={data} act={act} busy={busy} />}
                </>
              )}
              {page === "student-lookup" && teacher && (
                <StudentLookup
                  data={data}
                  renderDetails={(s) => (
                    <>
                      <AttendanceSummary
                        students={data.students}
                        studentId={s.id}
                      />
                      <Stats data={data} studentId={s.id} now={currentNow} />
                    </>
                  )}
                />
              )}
              {page === "students" && admin && (
                <>
                  <AttendanceSummary students={data.students} />
                  <Students data={data} act={act} busy={busy} />
                </>
              )}
              {page === "warnings" && (
                <WarningCards
                  data={data}
                  canManage={teacher}
                  studentId={teacher ? undefined : me?.id}
                  act={act}
                  busy={busy}
                />
              )}
              {page === "records" && (
                <Records
                  data={data}
                  teacher={teacher}
                  canEdit={admin}
                  act={act}
                  now={currentNow}
                  busy={busy}
                />
              )}
              {page === "notices" && (
                <Notices data={data} teacher={admin} act={act} busy={busy} />
              )}
              {page === "suggestions" && (
                <Suggestions
                  data={data}
                  teacher={teacher}
                  canReply={admin}
                  act={act}
                  busy={busy}
                />
              )}
              {page === "stats" && (
                <Statistics data={data} teacher={teacher} now={currentNow} />
              )}
              {page === "settings" && admin && (
                <>
                  <MenuOrderEditor
                    config={menuConfig}
                    onSaved={updateMenuConfig}
                    act={act}
                    busy={busy}
                  />
                  <TeacherAccess act={act} busy={busy} />
                  <SiteCopyEditor
                    copy={copy}
                    onSaved={updateCopy}
                    act={act}
                    busy={busy}
                  />
                  <SettingsPanel data={data} act={act} busy={busy} />
                </>
              )}
            </>
          )}
          <footer>
            온실 · 함께 만드는 몰입의 시간{" "}
            <span>
              {mode === "demo"
                ? "이 화면은 가상 학생 데이터입니다."
                : "출결과 통계는 서버 기록을 기준으로 합니다."}
            </span>
          </footer>
        </div>
      </main>
      {scan && (
        <Scanner
          direction={scan}
          close={() => setScan(null)}
          submit={async (qr, requestId) => {
            await act("attendance", {
              direction: scan,
              qr,
              request_id: requestId,
            });
            setScan(null);
          }}
        />
      )}
    </div>
  );
}
function TeacherAccess({
  act,
  busy,
}: {
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [code, setCode] = useState("");
  return (
    <div className="panel">
      <h2>교사 접속 코드</h2>
      <p>
        다른 선생님은 로그인 화면의 ‘교사’에서 이 코드를 입력합니다.
        출결·좌석·공지·건의사항·통계를 조회하고 경고카드를 발급·삭제할 수
        있습니다. 학생 정보와 출결·좌석 수정은 관리자만 가능합니다.
      </p>
      {code && (
        <p>
          <code>{code}</code>
        </p>
      )}
      <div className="actions">
        <button
          disabled={busy}
          onClick={() =>
            void act("teacher_code", {})
              .then((r) => setCode(r.code))
              .catch(() => {})
          }
        >
          코드 확인
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                "교사용 코드를 재발급합니다. 기존 코드와 모든 교사 조회 세션이 폐기됩니다.",
              )
            )
              void act("teacher_code_rotate", {})
                .then((r) => setCode(r.code))
                .catch(() => {});
          }}
        >
          코드 재발급
        </button>
      </div>
    </div>
  );
}
function SiteCopyEditor({
  copy,
  onSaved,
  act,
  busy,
}: {
  copy: SiteCopy;
  onSaved: (copy: SiteCopy) => void;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(copy);
  useEffect(() => setDraft(copy), [copy]);
  const labels: Record<keyof SiteCopy, string> = {
    hero_eyebrow: "큰 제목 위의 문구",
    hero_title: "큰 제목",
    hero_description: "큰 제목 아래 설명",
    login_title: "로그인 영역 제목",
    login_greeting: "로그인 안내 문구",
    production_badge: "운영 모드 표시 문구",
    ranking_encouragement: "순위 응원 문구",
  };
  return (
    <div className="panel">
      <h2>화면 문구 편집</h2>
      <p>
        로그인 화면과 순위 화면의 문구를 수정할 수 있습니다. 줄바꿈도 그대로
        반영됩니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("site_copy", { copy: draft })
            .then(onSaved)
            .catch(() => {});
        }}
      >
        {(Object.keys(labels) as (keyof SiteCopy)[]).map((key) => (
          <Field key={key} label={labels[key]}>
            <textarea
              aria-label={labels[key]}
              rows={
                key === "ranking_encouragement"
                  ? 6
                  : key === "hero_title" || key === "hero_description"
                    ? 3
                    : 2
              }
              maxLength={2000}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </Field>
        ))}
        <div className="actions">
          <button disabled={busy} className="primary">
            문구 저장
          </button>
          <button
            type="button"
            onClick={() => setDraft({ ...defaultSiteCopy })}
          >
            기본 문구 불러오기
          </button>
        </div>
      </form>
    </div>
  );
}
function Login({
  onLogin,
  busy,
  error,
  copy,
  copyReady,
}: {
  onLogin: (
    r: Role,
    c: string,
    e: string,
    p: string,
    remember: boolean,
  ) => void;
  busy: boolean;
  error: string;
  copy: SiteCopy;
  copyReady: boolean;
}) {
  const [saved] = useState(() => rememberedLogin(mode));
  const [role, setRole] = useState<Role>(saved.role),
    [code, setCode] = useState(saved.codes[saved.role] || ""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [remember, setRemember] = useState(!!saved.codes[saved.role]);
  const chooseRole = (next: Role) => {
    setRole(next);
    const value =
      next === "teacher" ? "" : rememberedLogin(mode).codes[next] || "";
    setCode(value);
    setRemember(!!value);
  };
  return (
    <div className="login">
      <section className="login-story">
        <a className="brand" href="#">
          <b>◒</b>
          <span>
            온실<small>STUDY ROOM</small>
          </span>
        </a>
        {copyReady ? (
          <>
            <p className="eyebrow">{copy.hero_eyebrow}</p>
            <h1 style={{ whiteSpace: "pre-line" }}>{copy.hero_title}</h1>
            <p style={{ whiteSpace: "pre-line" }}>{copy.hero_description}</p>
          </>
        ) : (
          <div
            className="login-copy-loading"
            aria-busy="true"
            aria-label="화면 문구를 불러오는 중"
          >
            <div />
            <div />
            <div />
          </div>
        )}
        <div className="illustration">
          <div>01</div>
          <div>02</div>
          <div>03</div>
          <div>04</div>
          <div>05</div>
          <div>06</div>
        </div>
        <small>나의 자리 · 나의 시간 · 함께하는 성장</small>
      </section>
      <section className="login-form">
        <span className="mode demo">
          {mode === "demo" ? "가상 데이터 데모" : copy.production_badge}
        </span>
        <h2>{copy.login_title}</h2>
        <p>{copy.login_greeting}</p>
        <div className="tabs">
          <button
            className={role === "student" ? "active" : ""}
            onClick={() => chooseRole("student")}
          >
            학생
          </button>
          <button
            className={role === "viewer" ? "active" : ""}
            onClick={() => chooseRole("viewer")}
          >
            교사
          </button>
          <button
            className={role === "teacher" ? "active" : ""}
            onClick={() => chooseRole("teacher")}
          >
            관리자
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(role, code, email, password, remember);
          }}
        >
          {role === "student" || role === "viewer" ? (
            <Field
              label={role === "viewer" ? "교사용 접속 코드" : "개인 접속 코드"}
            >
              <input
                name={role === "viewer" ? "teacher-code" : "student-code"}
                autoComplete="username"
                spellCheck={false}
                enterKeyHint="go"
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="5자리 코드 입력"
                maxLength={5}
                required
              />
            </Field>
          ) : mode === "production" ? (
            <>
              <Field label="관리자 이메일">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                />
              </Field>
              <Field label="비밀번호">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </Field>
            </>
          ) : (
            <p>관리자 데모는 가상 학생 72명을 관리합니다.</p>
          )}
          {(role === "student" || role === "viewer") && (
            <div className="remember-login">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => {
                    setRemember(e.target.checked);
                    if (!e.target.checked) rememberLogin(mode, role, "", false);
                  }}
                />{" "}
                이 기기에서 코드 기억하기
              </label>
              {remember && (
                <small>
                  개인 기기에서만 사용하세요. 다음 방문 때 코드가 자동으로
                  채워집니다.
                </small>
              )}
              {!!rememberedLogin(mode).codes[role] && (
                <button
                  type="button"
                  onClick={() => {
                    rememberLogin(mode, role, "", false);
                    setCode("");
                    setRemember(false);
                  }}
                >
                  저장한 코드 지우기
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "인증 중…" : "로그인 →"}
          </button>
        </form>
        {mode === "demo" && (
          <div className="demo-info">
            <b>설정 없이 체험하기</b>
            <p>
              학생 코드: <code>S2K9D</code>
            </p>
            <button onClick={() => setCode("S2K9D")}>데모 코드 채우기</button>
            <button
              onClick={async () => {
                const { demoReset } = await import("./demo");
                demoReset();
                location.reload();
              }}
            >
              가상 데이터 초기화
            </button>
            <small>
              데모 로그인·코드는 브라우저 시연용입니다.
              <br />
              운영 모드에서는 서버에서 인증합니다.
            </small>
          </div>
        )}
        <small>개인 접속 코드는 다른 사람과 공유하지 마세요.</small>
      </section>
    </div>
  );
}
function SeatStudentDetails({
  data,
  studentId,
  now,
  close,
  act,
  busy,
}: {
  data: Snapshot;
  studentId: string;
  now: number;
  close: () => void;
  busy: boolean;
  act: (action: string, payload: any) => Promise<any>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const student = data.students.find(
    (s) => s.id === studentId && !s.deleted_at,
  );
  return (
    <dialog
      ref={dialog}
      className="seat-student-details"
      aria-label={student ? `${student.name} 학생 상세` : "학생 상세"}
      onClose={close}
    >
      {student ? (
        <StudentLookup
          data={data}
          initialSelectedId={studentId}
          onClose={() => dialog.current?.close()}
          renderDetails={(s) => (
            <>
              <AttendanceSummary students={data.students} studentId={s.id} />
              <StudentWarningIssue student={s} busy={busy} act={act} />
              <Stats data={data} studentId={s.id} now={now} />
            </>
          )}
        />
      ) : (
        <div className="panel">
          <p>학생 정보를 찾을 수 없습니다.</p>
          <button onClick={() => dialog.current?.close()}>닫기</button>
        </div>
      )}
    </dialog>
  );
}
function Metric({
  label,
  value,
  unit,
  caption,
  onClick,
}: {
  label: string;
  value: string;
  unit: string;
  caption: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`metric${onClick ? " metric-action" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <div>
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <small>{caption}</small>
    </Tag>
  );
}
function CurrentStudents({ data }: { data: Snapshot }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "in" | "out">("in");
  const currentIds = new Set(
    data.visits
      .filter((visit) => !visit.exited_at)
      .map((visit) => visit.student_id),
  );
  const students = data.students
    .filter((student) => !student.deleted_at)
    .sort(
      (a, b) =>
        a.number.localeCompare(b.number, "ko", { numeric: true }) ||
        a.name.localeCompare(b.name, "ko"),
    );
  const inside = students.filter((student) =>
    currentIds.has(student.id),
  ).length;
  const visible = students.filter(
    (student) =>
      (status === "all" || currentIds.has(student.id) === (status === "in")) &&
      `${student.name} ${student.number} ${student.seat_id ?? "미배정"}`.includes(
        search.trim(),
      ),
  );
  return (
    <>
      <Metric
        label="현재 입실 인원"
        value={String(data.current)}
        unit={`/ ${data.settings.capacity}명`}
        caption="학생 명단 보기 ↗"
        onClick={() => {
          setSearch("");
          setStatus("in");
          dialog.current?.showModal();
        }}
      />
      <dialog
        ref={dialog}
        className="current-students"
        aria-labelledby="current-students-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              dialog.current?.close();
          }
        }}
      >
        <div className="current-students-head">
          <div>
            <h2 id="current-students-title">
              학생 입실 현황 <span>{inside}명 입실</span>
            </h2>
            <p>학번순 · 미입실은 현재 자습실에 없는 학생입니다.</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            autoFocus
            aria-label="입실 학생 명단 닫기"
          >
            닫기
          </button>
        </div>
        <div className="current-students-filters">
          <div
            className="current-students-tabs"
            role="group"
            aria-label="입실 상태 선택"
          >
            {(
              [
                ["in", "현재입실", inside],
                ["out", "미입실", students.length - inside],
                ["all", "전체", students.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          <Field label="이름·학번·좌석번호 검색">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름, 학번 또는 좌석번호 입력"
            />
          </Field>
          <p className="current-students-result" role="status">
            조회 {visible.length}명
          </p>
        </div>
        <div className="current-students-list">
          {visible.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">학번</th>
                  <th scope="col">이름</th>
                  <th scope="col">좌석</th>
                  <th scope="col">상태</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((student) => (
                  <tr key={student.id}>
                    <td>{student.number}</td>
                    <td>{student.name}</td>
                    <td>
                      {student.seat_id ? `${student.seat_id}번` : "미배정"}
                    </td>
                    <td>
                      <span
                        className={`current-students-state ${currentIds.has(student.id) ? "is-in" : "is-out"}`}
                      >
                        {currentIds.has(student.id) ? "현재입실" : "미입실"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">
              {search.trim()
                ? "검색 결과가 없습니다."
                : status === "in"
                  ? "현재 입실한 학생이 없습니다."
                  : status === "out"
                    ? "미입실 학생이 없습니다."
                    : "등록된 학생이 없습니다."}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="panel empty">{text}</div>;
}
function SeatMap({
  data,
  teacher,
  selected,
  onSelect,
}: {
  data: Snapshot;
  teacher: boolean;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const rows = [...new Set(data.seats.map((s) => s.row))].sort((a, b) => a - b);
  return (
    <div className="panel">
      <GenderLegend />
      <div className="seat-legend">
        <span>
          <i className="dot" />
          입실 중
        </span>
        <span>{teacher ? "○ 미입실·퇴실 · 회색" : "○ 퇴실"}</span>
        <span>▨ 사용 불가</span>
        <span>내 좌석 / 선택 좌석</span>
      </div>
      <div className="seat-scroll">
        <div className="seat-room">
          <div className="room-caption">1층 프로젝트실 · 72석</div>
          {rows.map((row) => (
            <div
              className={`seat-row ${row === 5 ? "cross-aisle" : ""}`}
              key={row}
            >
              {data.seats
                .filter((s) => s.row === row)
                .sort((a, b) => a.col - b.col)
                .map((seat) => {
                  const st = data.students.find((s) => s.seat_id === seat.id);
                  const inside =
                    st &&
                    data.visits.some(
                      (v) => v.student_id === st.id && !v.exited_at,
                    );
                  return (
                    <button
                      style={{ gridColumn: seat.col }}
                      className={`seat ${st?.gender === "male" ? "gender-male" : st?.gender === "female" ? "gender-female" : ""} ${inside && teacher ? "occupied" : ""} ${teacher && st && !inside ? "not-in-room" : ""} ${selected && st?.id === selected ? "mine" : ""} ${seat.enabled ? "" : "disabled"}`}
                      key={seat.id}
                      onClick={() => {
                        if (st) onSelect(st.id);
                      }}
                      aria-label={`${seat.id}번 좌석 ${teacher && st ? `${st.number} ${st.name}` : st && st.id === selected ? `${st.number} 내 좌석` : ""} ${teacher ? (inside ? "입실 중" : "퇴실") : ""} ${!seat.enabled ? "사용 불가" : ""}`}
                    >
                      <b>{seat.id.toString().padStart(2, "0")}</b>
                      {st && (teacher || st.id === selected) && (
                        <small>{st.number}</small>
                      )}
                      <small>
                        {teacher
                          ? st
                            ? st.name
                            : "미배정"
                          : st?.id === selected
                            ? "내 자리"
                            : seat.enabled
                              ? "좌석"
                              : "사용 불가"}
                      </small>
                      {st && (
                        <small>
                          {st.gender === "male"
                            ? "남학생"
                            : st.gender === "female"
                              ? "여학생"
                              : "성별 미확인"}
                        </small>
                      )}
                      {teacher && st && (
                        <small>{inside ? "● 입실 중" : "○ 퇴실"}</small>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
          <div
            className="room-front"
            aria-label="교실 아래쪽: 왼쪽 출입문, 가운데 교탁, 오른쪽 운동장"
          >
            <span>출입문</span>
            <span>칠판 · 교탁</span>
            <span>운동장</span>
          </div>
        </div>
      </div>
      <small>
        6열 × 12줄 · 두 자리씩 세 구역. 관리자는 좌석의 위치와 사용 여부를
        수정할 수 있습니다.
      </small>
    </div>
  );
}
function QRDisplay({ role, token }: { role: Role; token: string | null }) {
  const [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const loading = useRef(false);
  async function load(rotate = false) {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const qr = await api(rotate ? "qr_rotate" : "qr", {}, role, token);
      const { default: QRCode } = await import("qrcode");
      const img = await QRCode.toDataURL(qr.token, {
        width: 1000,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      if (alive.current) setImage(img);
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        if (rotate) setImage("");
      }
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [role, token]);
  return (
    <div className="panel qr-panel" ref={ref}>
      <div className="qr-poster">
        <p className="qr-brand">온실 · 자습실</p>
        <h2>입실·퇴실 현장 QR</h2>
        <CheckoutGuide />
        <p>
          ① 내 코드로 로그인
          <br />② 입실 또는 퇴실 버튼 선택
          <br />③ 아래 QR 스캔
        </p>
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : image ? (
          <img src={image} alt="인쇄용 고정 입퇴실 QR" />
        ) : (
          <p>고정 QR을 불러오고 있습니다…</p>
        )}
        <p className="qr-site">
          {mode === "production"
            ? "https://fnsrbs.github.io/Jaseub/"
            : location.href.split("#")[0]}
        </p>
        <p className="muted">
          이 QR은 자동으로 바뀌지 않습니다.
          <br />
          학생 로그인 후 앱 안에서 스캔하세요.
        </p>
      </div>
      <div className="qr-controls actions">
        <button
          className="primary"
          disabled={!image || busy || !!error}
          onClick={() => window.print()}
        >
          QR 인쇄
        </button>
        <button disabled={busy} onClick={() => void load()}>
          다시 불러오기
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (
              confirm(
                "QR을 재발급하면 기존 인쇄본은 사용할 수 없습니다. 재발급할까요?",
              )
            )
              void load(true);
          }}
        >
          QR 재발급
        </button>
        <button
          onClick={() => {
            ref.current
              ?.requestFullscreen()
              .catch(() =>
                setError("전체 화면을 지원하지 않는 브라우저입니다."),
              );
          }}
        >
          전체 화면 표시
        </button>
      </div>
      <p className="muted qr-controls">
        재발급할 때만 QR이 변경됩니다. 재발급 후에는 새 인쇄본으로 교체해
        주세요.
        <br />
        고정 QR은 사진이나 복사본으로 전달될 수 있어 현장 여부를 완벽하게
        보장하지 않습니다.
      </p>
    </div>
  );
}
function Scanner({
  direction,
  close,
  submit,
}: {
  direction: "in" | "out";
  close: () => void;
  submit: (qr: string, id: string) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [status, setStatus] = useState("카메라를 준비하세요."),
    [manual, setManual] = useState(""),
    [busy, setBusy] = useState(false);
  const camera = useRef<Html5Qrcode | null>(null),
    lock = useRef(false),
    request = useRef({ qr: "", id: "" });
  const stop = async () => {
    if (camera.current?.isScanning) await camera.current.stop();
  };
  useEffect(
    () => () => {
      void stop().catch(() => {});
    },
    [],
  );
  async function send(text: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!validQr(text))
        throw Error("온실 현장 QR 형식이 아닙니다. 외부 URL은 열지 않습니다.");
      await stop();
      if (request.current.qr !== text)
        request.current = { qr: text, id: crypto.randomUUID() };
      setStatus("서버에 저장 중…");
      await submit(text, request.current.id);
    } catch (e) {
      setError((e as Error).message);
      setStatus("완료되지 않았습니다. 다시 시도하세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start() {
    setError("");
    try {
      await stop();
      const { Html5Qrcode } = await import("html5-qrcode");
      camera.current ??= new Html5Qrcode("camera-reader");
      await camera.current.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 240, height: 240 } },
        (text) => {
          void send(text);
        },
        () => {},
      );
      setStatus("현장 QR을 화면 안에 맞춰 주세요.");
    } catch (e) {
      setError(
        /dynamically imported module|module script|loading chunk/i.test(
          (e as Error).message || String(e),
        )
          ? "화면이 업데이트되었거나 연결이 일시적으로 끊겼습니다. 새로고침 후 다시 시도해 주세요."
          : "카메라를 사용할 수 없습니다. 새로고침한 뒤 카메라 권한을 ‘허용’하고 다시 시도하세요. 계속 안 되면 교사에게 수동 처리를 요청하세요.",
      );
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            void stop();
            close();
          }
          if (e.key === "Tab") {
            const controls = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]),input,select,textarea",
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id="scan-title">{direction === "in" ? "입실" : "퇴실"} QR 스캔</h2>
        {direction === "out" && <CheckoutGuide />}
        <CameraGuide />
        <div id="camera-reader" />
        <p role="status">{status}</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button autoFocus onClick={() => void start()} disabled={busy}>
            카메라 시작 / 재시도
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void stop()
                .catch(() => {})
                .finally(() => location.reload())
            }
          >
            새로고침
          </button>
          <button
            onClick={() => {
              void stop();
              close();
            }}
            disabled={busy}
          >
            닫기
          </button>
        </div>
        {mode === "demo" && (
          <div className="demo-info">
            <p>
              같은 브라우저의 교사 데모에서 QR을 표시한 후 학생으로
              로그인하세요.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void import("./demo")
                  .then(({ demoQr }) => send(demoQr().token))
                  .catch(() => {})
              }
            >
              현재 데모 QR로 시연
            </button>
            <Field label="QR 내용으로 시연">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </Field>
            <button disabled={busy} onClick={() => void send(manual)}>
              검증 및 저장
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
function Students({
  data,
  act,
  busy,
}: {
  data: Snapshot;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [sortOrder, setSortOrder] = useState("number-asc");
  const [search, setSearch] = useState(""),
    [edit, setEdit] = useState<Partial<Student>>({ name: "", number: "" }),
    [code, setCode] = useState("");
  const [codeOwner, setCodeOwner] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [genderFilter, setGenderFilter] = useState("all"),
    [picked, setPicked] = useState<string[]>([]),
    [bulkGender, setBulkGender] = useState("unknown");
  const visible = data.students
    .filter(
      (s) =>
        !s.deleted_at &&
        `${s.name} ${s.number}`.includes(search) &&
        (genderFilter === "all" || (s.gender || "unknown") === genderFilter),
    )
    .sort((a, b) => {
      const compare = new Intl.Collator("ko", { numeric: true });
      if (sortOrder === "name")
        return (
          compare.compare(a.name, b.name) || compare.compare(a.number, b.number)
        );
      return (
        (sortOrder === "number-desc" ? -1 : 1) *
        (compare.compare(a.number, b.number) || compare.compare(a.name, b.name))
      );
    });
  return (
    <>
      <div className="metrics" aria-label="학생 등록 현황">
        <Metric
          label="전체 등록 인원"
          value={String(data.students.filter((s) => !s.deleted_at).length)}
          unit="명"
          caption="삭제된 학생 제외 · 검색 조건과 무관"
        />
        <Metric
          label="이용 가능 인원"
          value={String(
            data.students.filter((s) => !s.deleted_at && s.active).length,
          )}
          unit="명"
          caption="자습실 이용이 가능한 학생"
        />
        <Metric
          label="이용 제한 인원"
          value={String(
            data.students.filter((s) => !s.deleted_at && !s.active).length,
          )}
          unit="명"
          caption="이용이 중지된 학생"
        />
      </div>
      <div className="panel">
        <h2>{edit.id ? "학생 정보 수정" : "학생 등록"}</h2>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              !confirm(
                "구글 출석부에서 앱에 없는 학생만 추가할까요? 기존 학생 정보와 삭제한 학생은 유지합니다.",
              )
            )
              return;
            setImportMessage("");
            void act("roster_import", {})
              .then((r) =>
                setImportMessage(
                  `신규 ${r.added}명 추가 · 기존 ${r.skipped}명 유지. 새 학생의 코드는 학생 목록에서 확인하세요.`,
                ),
              )
              .catch(() => {});
          }}
        >
          구글 출석부에서 새 학생 불러오기
        </button>
        <p>
          최초 연결은 좌석 관리의 구글 시트 연결 설정에서 진행하세요. 새 학생은
          성별 미확인·좌석 미배정으로 등록됩니다.
        </p>
        {importMessage && <p role="status">{importMessage}</p>}
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void act("student", edit)
              .then(() => setEdit({ name: "", number: "" }))
              .catch(() => {});
          }}
        >
          <Field label="이름">
            <input
              required
              maxLength={80}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field label="학번">
            <input
              required
              maxLength={40}
              value={edit.number}
              onChange={(e) => setEdit({ ...edit, number: e.target.value })}
            />
          </Field>
          <Field label="성별">
            <select
              value={edit.gender || "unknown"}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  gender: e.target.value as Student["gender"],
                })
              }
            >
              <option value="unknown">미확인</option>
              <option value="male">남자</option>
              <option value="female">여자</option>
            </select>
          </Field>
          {edit.id && (
            <Field label="이용 상태">
              <select
                value={String(edit.active)}
                onChange={(e) =>
                  setEdit({ ...edit, active: e.target.value === "true" })
                }
              >
                <option value="true">이용 가능</option>
                <option value="false">이용 중지</option>
              </select>
            </Field>
          )}
          <button disabled={busy} className="primary">
            저장
          </button>
          <button
            type="button"
            onClick={() => setEdit({ name: "", number: "" })}
          >
            새 학생
          </button>
        </form>
      </div>
      {code && (
        <div className="alert success">
          <b>{codeOwner} · 개인 접속 코드</b>
          <p>
            <code>{code}</code>
          </p>
          <button onClick={() => setCode("")}>확인 후 닫기</button>
          <small>재발급 시 이전 코드와 세션이 폐기됩니다.</small>
        </div>
      )}
      <Field label="이름·학번 검색">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="학생 검색"
        />
      </Field>
      <div className="panel form-grid">
        <Field label="학생 정렬">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="number-asc">학번 오름차순</option>
            <option value="number-desc">학번 내림차순</option>
            <option value="name">이름순</option>
          </select>
        </Field>
        <Field label="성별 필터">
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
          >
            <option value="all">전체</option>
            <option value="male">남학생</option>
            <option value="female">여학생</option>
            <option value="unknown">미확인</option>
          </select>
        </Field>
        <button onClick={() => setPicked(visible.map((s) => s.id))}>
          검색 결과 전체 선택
        </button>
        <button onClick={() => setPicked([])}>선택 해제</button>
        <Field label={`선택 ${picked.length}명 일괄 지정`}>
          <select
            value={bulkGender}
            onChange={(e) => setBulkGender(e.target.value)}
          >
            <option value="unknown">미확인</option>
            <option value="male">남자</option>
            <option value="female">여자</option>
          </select>
        </Field>
        <button
          disabled={busy || !picked.length}
          onClick={() =>
            void act("student_gender", { ids: picked, gender: bulkGender })
              .then(() => setPicked([]))
              .catch(() => {})
          }
        >
          성별 적용
        </button>
      </div>
      <div className="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>선택</th>
              <th>이름</th>
              <th>학번</th>
              <th>성별</th>
              <th>좌석</th>
              <th>누적 경고</th>
              <th>이용 상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${s.name} 선택`}
                    checked={picked.includes(s.id)}
                    onChange={() =>
                      setPicked(
                        picked.includes(s.id)
                          ? picked.filter((id) => id !== s.id)
                          : [...picked, s.id],
                      )
                    }
                  />
                </td>
                <td>{s.name}</td>
                <td>{s.number}</td>
                <td>
                  <select
                    aria-label={`${s.name} 성별`}
                    disabled={busy}
                    value={s.gender || "unknown"}
                    onChange={(e) =>
                      void act("student_gender", {
                        ids: [s.id],
                        gender: e.target.value,
                      }).catch(() => {})
                    }
                  >
                    <option value="unknown">미확인</option>
                    <option value="male">남자</option>
                    <option value="female">여자</option>
                  </select>
                </td>
                <td>{s.seat_id || "미배정"}</td>
                <td>
                  <a href="#warnings">
                    ▣{" "}
                    {
                      (data.warnings || []).filter((w) => w.student_id === s.id)
                        .length
                    }
                    장
                  </a>
                </td>
                <td>{s.active ? "이용 가능" : "이용 중지"}</td>
                <td>
                  <button
                    onClick={() => {
                      setEdit(s);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    수정
                  </button>{" "}
                  <button
                    disabled={busy || !s.active}
                    onClick={() =>
                      void act("student_code", { student_id: s.id })
                        .then((r) => {
                          setCode(r.code);
                          setCodeOwner(`${s.name} (${s.number})`);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        })
                        .catch(() => {})
                    }
                  >
                    코드 확인
                  </button>
                  <button
                    disabled={busy || !s.active}
                    onClick={() => {
                      if (
                        confirm(
                          `${s.name}의 접속 코드를 발급/재발급합니다. 기존 세션은 차단됩니다.`,
                        )
                      )
                        void act("code", { student_id: s.id })
                          .then((r) => {
                            setCode(r.code);
                            setCodeOwner(`${s.name} (${s.number})`);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          })
                          .catch(() => {});
                    }}
                  >
                    코드 발급 / 재발급
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          `${s.name} (${s.number}) 학생을 삭제할까요? 로그인과 좌석 배정을 해제하며 기존 출결 기록은 보존합니다.`,
                        )
                      )
                        void act("student_delete", { id: s.id })
                          .then(() => {
                            setPicked(picked.filter((id) => id !== s.id));
                            if (edit.id === s.id)
                              setEdit({ name: "", number: "" });
                          })
                          .catch(() => {});
                    }}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function SeatAdmin({
  data,
  act,
  busy,
}: {
  data: Snapshot;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(
      data.students.filter((s) => s.active).map((s) => s.id),
    ),
    [available, setAvailable] = useState(
      data.seats.filter((s) => s.enabled).map((s) => s.id),
    ),
    [fixed, setFixed] = useState<string[]>([]),
    [sameGender, setSameGender] = useState(false),
    [preview, setPreview] = useState<
      { student_id: string; seat_id: number | null }[] | null
    >(null),
    [error, setError] = useState(""),
    [seat, setSeat] = useState({ id: 1, row: 1, col: 1, enabled: true });
  const toggle = (array: any[], value: any) =>
    array.includes(value)
      ? array.filter((v) => v !== value)
      : [...array, value];
  const draw = () => {
    try {
      setPreview(
        (sameGender ? pairLottery : lottery)(
          data.students,
          data.seats,
          selected,
          available,
          fixed,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    }
  };
  const confirmDraft = () => {
    if (!preview?.length) return;
    try {
      if (sameGender) validateDeskPairs(data.students, data.seats, preview);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    void act("assign", { pairs: preview, same_gender_pairs: sameGender })
      .then(() => {
        setPreview(null);
        setError("");
      })
      .catch(() => {});
  };
  return (
    <>
      <div className="panel">
        <h2>좌석 배정 · 클릭해서 변경</h2>
        <SeatPrint data={data} />
        <SeatSheetSync hasDraft={!!preview?.length} busy={busy} act={act} />
        <label className="pair-option">
          <input
            type="checkbox"
            checked={sameGender}
            onChange={(e) => {
              setSameGender(e.target.checked);
              setPreview(null);
            }}
          />{" "}
          남학생끼리 · 여학생끼리 짝 배정
        </label>
        <small>
          같은 성별끼리 짝을 배정합니다. 홀수 인원은 빈 짝자리가 생길 수
          있습니다.
        </small>
        <div className="actions seat-draft-actions">
          <button className="primary" disabled={busy} onClick={draw}>
            추첨 미리보기 / 다시 추첨
          </button>
          {!!preview?.length && (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={confirmDraft}
              >
                배정 저장
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setError("");
                }}
              >
                미리보기 취소
              </button>
              <span role="status">
                저장 전 · {preview.length}명 배정 미리보기
              </span>
            </>
          )}
        </div>
        <SeatArrangement
          data={data}
          draft={preview || []}
          fixed={fixed}
          onChange={(pairs) => {
            setPreview(pairs);
            setError("");
          }}
        />
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      <div className="panel">
        <h2>좌석 번호·위치 관리</h2>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void act("seat", seat).catch(() => {});
          }}
        >
          <Field label="좌석 번호">
            <input
              type="number"
              min="1"
              value={seat.id}
              onChange={(e) => {
                const id = +e.target.value;
                setSeat(
                  data.seats.find((s) => s.id === id) || {
                    id,
                    row: 10,
                    col: 1,
                    enabled: true,
                  },
                );
              }}
            />
          </Field>
          <Field label="행">
            <input
              type="number"
              min="1"
              value={seat.row}
              onChange={(e) => setSeat({ ...seat, row: +e.target.value })}
            />
          </Field>
          <Field label="열">
            <input
              type="number"
              min="1"
              value={seat.col}
              onChange={(e) => setSeat({ ...seat, col: +e.target.value })}
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={seat.enabled}
              onChange={(e) => setSeat({ ...seat, enabled: e.target.checked })}
            />{" "}
            사용 가능
          </label>
          <button disabled={busy}>좌석 저장</button>
        </form>
      </div>
      <div className="panel">
        <h2>좌석 재추첨</h2>
        <p>
          대상 학생과 좌석을 고르고, 유지할 좌석은 고정하세요. 저장 전에는 기존
          배정이 유지됩니다.
        </p>
        <div className="pick-grid">
          <div>
            <h3>대상 학생 / 기존 좌석 고정</h3>
            <p>
              남녀를 따로 배정하려면 한 그룹을 선택하고 사용할 좌석 구역을 고른
              뒤 저장하세요. 선택하지 않은 학생의 자리는 유지됩니다.
            </p>
            {(
              [
                ["male", "남학생"],
                ["female", "여학생"],
                ["unknown", "미확인"],
              ] as const
            ).map(([gender, label]) => (
              <button
                key={gender}
                onClick={() => {
                  setSelected(
                    data.students
                      .filter(
                        (s) => s.active && (s.gender || "unknown") === gender,
                      )
                      .map((s) => s.id),
                  );
                  setPreview(null);
                }}
              >
                {label}만 선택
              </button>
            ))}
            <button
              onClick={() => {
                setSelected(
                  data.students.filter((s) => s.active).map((s) => s.id),
                );
                setPreview(null);
              }}
            >
              활동 학생 전체 선택
            </button>
            <button
              onClick={() => {
                setSelected([]);
                setPreview(null);
              }}
            >
              선택 해제
            </button>
            <div className="picker">
              {data.students
                .filter((s) => !s.deleted_at)
                .map((s) => (
                  <div key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(s.id)}
                        onChange={() => {
                          setSelected(toggle(selected, s.id));
                          setPreview(null);
                        }}
                      />
                      {s.name} · {s.seat_id || "미배정"}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={fixed.includes(s.id)}
                        onChange={() => {
                          setFixed(toggle(fixed, s.id));
                          setPreview(null);
                        }}
                      />
                      고정
                    </label>
                  </div>
                ))}
            </div>
          </div>
          <SeatPicker
            data={data}
            available={available}
            selected={selected}
            fixed={fixed}
            onChange={(ids) => {
              setAvailable(ids);
              setPreview(null);
            }}
          />
        </div>
      </div>
    </>
  );
}

function Records({
  data,
  teacher,
  canEdit,
  act,
  now,
  busy,
}: {
  data: Snapshot;
  teacher: boolean;
  canEdit: boolean;
  act: (a: string, p: any) => Promise<any>;
  now: number;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [student, setStudent] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [edit, setEdit] = useState<Visit | null>(null),
    [entered, setEntered] = useState(""),
    [exited, setExited] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => setPicked([]), [student, from, to]);
  const visits = data.visits.filter(
    (v) =>
      (!student || v.student_id === student) &&
      (!from || koreanDay(v.entered_at) >= from) &&
      (!to || koreanDay(v.entered_at) <= to),
  );
  const chosen = visits.filter((v) => picked.includes(v.id));
  const selectable = visits.slice(0, 1000);
  const allPicked =
    selectable.length > 0 && selectable.every((v) => picked.includes(v.id));
  return (
    <>
      <div className="panel form-grid">
        {teacher && (
          <Field label="학생">
            <select
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">전체 학생</option>
              {data.students.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="시작일">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="종료일">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        {teacher && (
          <button
            onClick={() =>
              download(
                "출결.csv",
                csv([
                  [
                    "학생",
                    "학번",
                    "입실(한국)",
                    "퇴실(한국)",
                    "공부시간(초)",
                    "상태",
                  ],
                  ...visits.map((v) => {
                    const s = data.students.find((s) => s.id === v.student_id)!;
                    return [
                      s.name,
                      s.number,
                      csvTime(v.entered_at),
                      csvTime(v.exited_at),
                      v.exited_at
                        ? (Date.parse(v.exited_at) - Date.parse(v.entered_at)) /
                          1000
                        : "",
                      v.exited_at
                        ? "퇴실 완료"
                        : now - Date.parse(v.entered_at) >
                            data.settings.missing_hours * 3600000
                          ? "확인 필요"
                          : "진행 중",
                    ];
                  }),
                ]),
              )
            }
          >
            출결 CSV 다운로드
          </button>
        )}
      </div>
      {canEdit && edit && (
        <div className="panel">
          <h2>기록 시각 수정 · 한국 시각</h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void act("correct", {
                id: edit.id,
                entered_at: isoInput(entered),
                exited_at: exited ? isoInput(exited) : null,
                reason,
              })
                .then(() => setEdit(null))
                .catch(() => {});
            }}
          >
            <Field label="입실">
              <input
                type="datetime-local"
                required
                value={entered}
                onChange={(e) => setEntered(e.target.value)}
              />
            </Field>
            <Field label="퇴실 · 비우면 진행 중">
              <input
                type="datetime-local"
                value={exited}
                onChange={(e) => setExited(e.target.value)}
              />
            </Field>
            <Field label="수정 사유">
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <button disabled={busy}>수정 저장</button>
            <button type="button" onClick={() => setEdit(null)}>
              취소
            </button>
          </form>
        </div>
      )}
      {canEdit && (
        <div className="panel actions">
          <span>
            선택 {chosen.length}건 / 조회 {visits.length}건
          </span>
          <button
            type="button"
            disabled={busy || !visits.length}
            onClick={() => setPicked(selectable.map((v) => v.id))}
          >
            조회 기록 전체 선택{visits.length > 1000 ? " (최대 1000건)" : ""}
          </button>
          <button
            type="button"
            disabled={busy || !picked.length}
            onClick={() => setPicked([])}
          >
            선택 해제
          </button>
          <button
            type="button"
            disabled={busy || !chosen.length}
            onClick={() => {
              const reason = prompt(
                `선택한 출결 기록 ${chosen.length}건의 삭제 사유를 입력하세요. 삭제 전 기록은 관리자 변경 이력에 남습니다.`,
              );
              if (!reason?.trim()) return;
              const ongoing = chosen.filter((v) => !v.exited_at).length;
              if (
                !confirm(
                  `출결 기록 ${chosen.length}건을 삭제할까요?${ongoing ? ` 입실 중인 기록 ${ongoing}건도 포함됩니다.` : ""} 삭제하면 출결 현황과 이용 통계에 반영됩니다.`,
                )
              )
                return;
              void act("visits_delete", {
                ids: chosen.map((v) => v.id),
                reason: reason.trim(),
              })
                .then(() => {
                  setPicked([]);
                  if (edit && chosen.some((v) => v.id === edit.id))
                    setEdit(null);
                })
                .catch(() => {});
            }}
          >
            선택 기록 삭제
          </button>
        </div>
      )}
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              {canEdit && (
                <th>
                  <input
                    type="checkbox"
                    aria-label="조회 기록 전체 선택"
                    disabled={busy || !visits.length}
                    checked={allPicked}
                    ref={(el) => {
                      if (el)
                        el.indeterminate = chosen.length > 0 && !allPicked;
                    }}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked ? selectable.map((v) => v.id) : [],
                      )
                    }
                  />
                </th>
              )}
              {teacher && <th>학생</th>}
              <th>입실</th>
              <th>퇴실</th>
              <th>이용 시간</th>
              <th>상태</th>
              {canEdit && <th>관리</th>}
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => {
              const review =
                !v.exited_at &&
                now - Date.parse(v.entered_at) >
                  data.settings.missing_hours * 3600000;
              return (
                <tr key={v.id}>
                  {canEdit && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${data.students.find((s) => s.id === v.student_id)?.name || "학생"} ${time(v.entered_at)} 출결 기록 선택`}
                        disabled={
                          busy ||
                          (!picked.includes(v.id) && chosen.length >= 1000)
                        }
                        checked={picked.includes(v.id)}
                        onChange={(e) =>
                          setPicked(
                            e.target.checked
                              ? [...picked, v.id]
                              : picked.filter((id) => id !== v.id),
                          )
                        }
                      />
                    </td>
                  )}
                  {teacher && (
                    <td>
                      {data.students.find((s) => s.id === v.student_id)?.name}
                    </td>
                  )}
                  <td>{time(v.entered_at)}</td>
                  <td>{time(v.exited_at)}</td>
                  <td>
                    {review
                      ? "확인 필요"
                      : duration(
                          ((v.exited_at ? Date.parse(v.exited_at) : now) -
                            Date.parse(v.entered_at)) /
                            1000,
                        )}
                  </td>
                  <td>
                    {review
                      ? "⚠ 확인 필요"
                      : v.exited_at
                        ? "퇴실 완료"
                        : "● 진행 중"}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        onClick={() => {
                          setEdit(v);
                          setEntered(localInput(v.entered_at));
                          setExited(v.exited_at ? localInput(v.exited_at) : "");
                          setReason("");
                        }}
                      >
                        수정
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const reason = prompt(
                            "이 출결 기록을 삭제할 사유를 입력하세요. 삭제 전 내용은 관리자 변경 이력에 남습니다.",
                          );
                          if (
                            reason?.trim() &&
                            confirm(
                              `${time(v.entered_at)} 입실 기록을 삭제할까요? 이 기록은 출결 목록과 통계에서 제외됩니다.`,
                            )
                          )
                            void act("visit_delete", { id: v.id, reason })
                              .then(() => {
                                if (edit?.id === v.id) setEdit(null);
                              })
                              .catch(() => {});
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visits.length && <Empty text="이 기간의 이용 기록이 없습니다." />}
      </div>
      {!teacher && (
        <Stats data={data} studentId={data.students[0].id} now={now} />
      )}{" "}
      {canEdit && (
        <div className="panel">
          <h2>최근 수정·삭제·배정 이력</h2>
          {data.audits.map((a, i) => (
            <details key={i}>
              <summary>
                {String(a.created_at)} · {String(a.kind)} ·{" "}
                {String(a.reason)
                  .replace("좌석 배정 확정", "좌석 배정 저장")
                  .replace(
                    "확정 좌석 구글 시트 반영",
                    "좌석 배정 구글 시트 반영",
                  )}
              </summary>
              <pre>{JSON.stringify(a, null, 2)}</pre>
            </details>
          ))}
          {!data.audits.length && <p>수정 이력이 없습니다.</p>}
        </div>
      )}
    </>
  );
}
function NoticeCard({ n }: { n: Notice }) {
  return (
    <article className="panel notice">
      <div>{n.important && <span className="badge">중요 공지</span>}</div>
      <h3>{n.title}</h3>
      <p className="text-body">{n.body}</p>
    </article>
  );
}
function Notices({
  data,
  teacher,
  act,
  busy,
}: {
  data: Snapshot;
  teacher: boolean;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const blank = { title: "", body: "", important: false };
  const [edit, setEdit] = useState<Partial<Notice>>(blank);
  return (
    <>
      {teacher && (
        <div className="panel">
          <h2>{edit.id ? "공지 수정" : "공지 작성"}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("notice", edit)
                .then(() => setEdit(blank))
                .catch(() => {});
            }}
          >
            <Field label="제목">
              <input
                required
                maxLength={160}
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </Field>
            <Field label="내용">
              <textarea
                required
                maxLength={10000}
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={edit.important}
                onChange={(e) =>
                  setEdit({ ...edit, important: e.target.checked })
                }
              />{" "}
              중요 공지 · 상단 고정
            </label>
            <div className="actions">
              <button className="primary" disabled={busy}>
                저장
              </button>
              <button type="button" onClick={() => setEdit(blank)}>
                작성 초기화
              </button>
            </div>
          </form>
        </div>
      )}
      {[...data.notices]
        .sort(
          (a, b) =>
            Number(b.important) - Number(a.important) ||
            b.created_at.localeCompare(a.created_at),
        )
        .map((n) => (
          <div key={n.id}>
            <NoticeCard n={n} />
            {teacher && (
              <div className="actions">
                <button
                  onClick={() => {
                    setEdit(n);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  수정
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirm("공지를 삭제할까요?"))
                      void act("notice_delete", { id: n.id }).catch(() => {});
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      {!data.notices.length && <Empty text="등록된 공지가 없습니다." />}
    </>
  );
}
function Suggestions({
  data,
  teacher,
  canReply,
  act,
  busy,
}: {
  data: Snapshot;
  teacher: boolean;
  canReply: boolean;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  return (
    <>
      {!teacher && (
        <div className="panel">
          <h2>자습실에 의견 보내기</h2>
          <p>작성 학생과 교사만 내용을 확인할 수 있습니다.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("suggest", { title, body })
                .then(() => {
                  setTitle("");
                  setBody("");
                })
                .catch(() => {});
            }}
          >
            <Field label="제목">
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="내용">
              <textarea
                required
                maxLength={10000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
            <button className="primary" disabled={busy}>
              건의 등록
            </button>
          </form>
        </div>
      )}
      {data.suggestions.map((s) => (
        <article className="panel" key={s.id}>
          <span className="badge">{s.status}</span>
          <span className="muted">
            {" "}
            {teacher &&
              data.students.find((st) => st.id === s.student_id)?.name}{" "}
            · {time(s.created_at)}
          </span>
          <h3>{s.title}</h3>
          <p className="text-body">{s.body}</p>
          {s.reply && (
            <blockquote>
              <b>교사 답변</b>
              <p className="text-body">{s.reply}</p>
              <small>수정 {time(s.updated_at)}</small>
            </blockquote>
          )}
          {canReply && <Reply suggestion={s} act={act} busy={busy} />}
        </article>
      ))}
      {!data.suggestions.length && <Empty text="등록된 건의사항이 없습니다." />}
    </>
  );
}
function Reply({
  suggestion,
  act,
  busy,
}: {
  suggestion: Snapshot["suggestions"][number];
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [reply, setReply] = useState(suggestion.reply),
    [status, setStatus] = useState(suggestion.status);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act("reply", { id: suggestion.id, reply, status }).catch(() => {});
      }}
    >
      <Field label="답변">
        <textarea
          maxLength={10000}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
      </Field>
      <Field label="처리 상태">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {["접수", "확인 중", "처리 완료"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <button disabled={busy}>답변·상태 저장</button>
    </form>
  );
}
function Stats({
  data,
  studentId,
  now,
  compact = false,
}: {
  data: Snapshot;
  studentId: string;
  now: number;
  compact?: boolean;
}) {
  const t = totals(
    data.visits.filter((v) => v.student_id === studentId),
    now,
    data.settings.missing_hours,
  );
  const days = Object.entries(t.days).sort(([a], [b]) => b.localeCompare(a));
  const max = Math.max(1, ...days.map(([, v]) => v.confirmed));
  return (
    <>
      <div className="metrics stats">
        <Metric
          label="오늘 공부시간"
          value={duration(t.today)}
          unit=""
          caption="진행 중인 이용 시간 제외"
        />
        <Metric
          label="이번 주 공부시간"
          value={duration(t.week)}
          unit=""
          caption="월요일부터 금요일까지"
        />
        <Metric
          label="이번 달 공부시간"
          value={duration(t.month)}
          unit=""
          caption=""
        />
        {!compact && (
          <Metric
            label="전체 공부시간"
            value={duration(t.all)}
            unit=""
            caption={`공부한 날 ${t.count}일`}
          />
        )}
      </div>
      {!compact && (
        <div className="panel">
          <h2>날짜별 이용 시간</h2>
          {days.map(([day, v]) => (
            <div className="graph-row" key={day}>
              <span>{day}</span>
              <div>
                <i style={{ width: `${(v.confirmed / max) * 100}%` }} />
              </div>
              <span>
                {duration(v.confirmed)}
                {v.ongoing > 0 && ` · 진행 ${duration(v.ongoing)}`}
                {v.review > 0 && " · ⚠ 확인 필요"}
              </span>
            </div>
          ))}
          {!days.length && <p>이용 기록이 없습니다.</p>}
          <small>확인 필요 기록은 합계에서 제외합니다.</small>
        </div>
      )}
    </>
  );
}
function download(name: string, contents: string) {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Statistics({
  data,
  teacher,
  now,
}: {
  data: Snapshot;
  teacher: boolean;
  now: number;
}) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [sortOrder, setSortOrder] = useState("number-asc");
  if (!teacher)
    return <Stats data={data} studentId={data.students[0].id} now={now} />;
  const rows = data.students
    .map((s) => {
      const days = dailyUsage(
        data.visits.filter((v) => v.student_id === s.id),
        now,
        data.settings.missing_hours,
      );
      const chosen = Object.entries(days).filter(
        ([d]) => (!from || d >= from) && (!to || d <= to),
      );
      return {
        s,
        seconds: chosen.reduce((a, [, v]) => a + v.confirmed, 0),
        count: chosen.filter(([, v]) => v.confirmed > 0).length,
        ongoing: chosen.reduce((a, [, v]) => a + v.ongoing, 0),
        review: chosen.reduce((a, [, v]) => a + v.review, 0),
      };
    })
    .sort((a, b) => {
      if (sortOrder === "time-desc")
        return (
          b.seconds - a.seconds ||
          a.s.number.localeCompare(b.s.number, "ko", { numeric: true })
        );
      if (sortOrder === "name")
        return (
          a.s.name.localeCompare(b.s.name, "ko") ||
          a.s.number.localeCompare(b.s.number, "ko", { numeric: true })
        );
      return (
        (sortOrder === "number-desc" ? -1 : 1) *
        (a.s.number.localeCompare(b.s.number, "ko", { numeric: true }) ||
          a.s.name.localeCompare(b.s.name, "ko"))
      );
    });
  return (
    <>
      <div className="panel form-grid">
        <Field label="통계 정렬">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="number-asc">학번 오름차순</option>
            <option value="number-desc">학번 내림차순</option>
            <option value="name">이름순</option>
            <option value="time-desc">이용 시간 많은 순</option>
          </select>
        </Field>
        <Field label="시작일">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="종료일">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          onClick={() =>
            download(
              "이용통계.csv",
              csv([
                [
                  "학생",
                  "학번",
                  "공부시간(초)",
                  "공부한 날",
                  "진행 중 초",
                  "확인 필요 날짜 구간",
                ],
                ...rows.map((r) => [
                  r.s.name,
                  r.s.number,
                  r.seconds,
                  r.count,
                  r.ongoing,
                  r.review,
                ]),
              ]),
            )
          }
        >
          통계 CSV 다운로드
        </button>
      </div>
      <div className="metrics">
        <Metric
          label="전체 공부시간"
          value={duration(rows.reduce((a, r) => a + r.seconds, 0))}
          unit=""
          caption="학생별 공부시간 합계"
        />
        <Metric
          label="총 이용 일수"
          value={String(rows.reduce((a, r) => a + r.count, 0))}
          unit="학생·일"
          caption="학생별 이용 일수의 합계"
        />
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>학번</th>
              <th>학생</th>
              <th>공부시간</th>
              <th>이용 일수</th>
              <th>진행 중</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s.id}>
                <td>{r.s.number}</td>
                <td>{r.s.name}</td>
                <td>{duration(r.seconds)}</td>
                <td>{r.count}일</td>
                <td>
                  {r.review
                    ? "⚠ 확인 필요"
                    : r.ongoing
                      ? `진행 중 ${duration(r.ongoing)}`
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function SettingsPanel({
  data,
  act,
  busy,
}: {
  data: Snapshot;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [settings, setSettings] = useState(data.settings),
    [day, setDay] = useState(koreanDay(new Date())),
    [start, setStart] = useState("06:00"),
    [end, setEnd] = useState("17:00"),
    [targets, setTargets] = useState(
      data.students.filter((s) => s.active).map((s) => s.id),
    );
  const [settingsResult, setSettingsResult] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const activeCount = data.students.filter(
    (s) => s.active && !s.deleted_at,
  ).length;
  useEffect(() => {
    setSettings(data.settings);
  }, [
    data.settings.capacity,
    data.settings.exam_date,
    data.settings.missing_hours,
  ]);
  return (
    <>
      <div className="panel">
        <h2>기본 운영 설정</h2>
        <p>
          자동 일괄 퇴실: 월·화 오후 4시 30분 / 수·목·금 오후 3시 30분 (한국
          시간). 입실 중인 학생은 해당 시각에 자동 퇴실되며, 조퇴 등 중간 퇴실만
          QR로 기록합니다.
        </p>
        <p className="muted">
          전체 학생 인원수를 저장하면 운영현황의 현재 입실·오늘 출석 인원에
          표시되는 전체 인원(/○명)이 변경됩니다. 활동 학생 수보다 작게 설정할 수
          없습니다.
        </p>
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setSettingsResult("");
            setSettingsError("");
            if (settings.capacity < activeCount) {
              setSettingsError(
                `활동 학생이 ${activeCount}명이므로 ${activeCount}명 이상으로 입력해 주세요.`,
              );
              return;
            }
            try {
              await act("settings", settings);
              setSettingsResult(
                `전체 학생 인원수 ${settings.capacity}명 저장 완료. 운영현황에 /${settings.capacity}명으로 반영됩니다.`,
              );
            } catch (error) {
              setSettingsError((error as Error).message);
            }
          }}
        >
          <Field label="전체 학생 인원수">
            <input
              type="number"
              min="1"
              max="1000"
              value={settings.capacity}
              onChange={(e) =>
                setSettings({ ...settings, capacity: +e.target.value })
              }
              required
            />
          </Field>
          <Field label="수능 날짜">
            <input
              type="date"
              value={settings.exam_date || ""}
              onChange={(e) =>
                setSettings({ ...settings, exam_date: e.target.value || null })
              }
            />
          </Field>
          <Field label="퇴실 확인 필요 기준 (시간)">
            <input
              type="number"
              min="1"
              max="72"
              value={settings.missing_hours}
              onChange={(e) =>
                setSettings({ ...settings, missing_hours: +e.target.value })
              }
              required
            />
          </Field>
          <button className="primary" disabled={busy}>
            {busy ? "저장 중…" : "설정 저장"}
          </button>
        </form>
        <p className="muted">
          현재 저장된 전체 학생 인원수: {data.settings.capacity}명 · 활동 학생:{" "}
          {activeCount}명
        </p>
        {settingsError && (
          <p role="alert" className="error-text">
            {settingsError}
          </p>
        )}
        {settingsResult && <p role="status">{settingsResult}</p>}
      </div>
      <div className="panel">
        <h2>운영일·출석 대상 설정</h2>
        <p>
          등록된 날짜와 대상 학생에 한해 지각·결석 여부를 확인합니다. 결석
          여부는 운영 시간 이후에 확인할 수 있습니다.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("operating_day", {
              day,
              start_time: start,
              end_time: end,
              student_ids: targets,
            }).catch(() => {});
          }}
        >
          <div className="form-grid">
            <Field label="운영 날짜">
              <input
                type="date"
                required
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </Field>
            <Field label="입실 기준 시각">
              <input
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="운영 종료">
              <input
                type="time"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <div className="picker">
            {data.students.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={targets.includes(s.id)}
                  onChange={() =>
                    setTargets(
                      targets.includes(s.id)
                        ? targets.filter((id) => id !== s.id)
                        : [...targets, s.id],
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
          <button disabled={busy}>운영일 저장 / 수정</button>
        </form>
        <h3>등록된 운영일</h3>
        {data.operating_days.map((d) => (
          <p key={d.day}>
            {d.day} · {d.start_time} ~ {d.end_time} · 대상{" "}
            {d.student_ids.length}명{" "}
            <button
              onClick={() => {
                setDay(d.day);
                setStart(d.start_time);
                setEnd(d.end_time);
                setTargets(d.student_ids);
              }}
            >
              불러오기
            </button>
          </p>
        ))}
      </div>
    </>
  );
}
