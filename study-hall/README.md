# 온실 · 자습실 출결 및 좌석 관리

React + TypeScript + Vite / Supabase Postgres + Auth + Edge Functions / GitHub Pages.
기존 상위 폴더의 Google Apps Script 앱과 실제 명단 파일은 사용하거나 변경하지 않습니다.
기본 데모는 **가상 학생 72명**이며 외부 계정과 키 없이 실행됩니다. 운영 모드는 Supabase에 기록합니다.

## 바로 실행

Node.js 22 이상에서 이 폴더를 작업 디렉터리로 사용합니다.

```powershell
cd 'C:\Users\user\Documents\ChatGPT\자습반운영\study-hall'
npm ci
Copy-Item .env.example .env
npm run dev
```

표시된 `http://127.0.0.1:5173/`를 엽니다. 학생 코드 `S2K9D`; 교사 탭은 비밀번호 없이 데모 로그인합니다.
`npm test`는 계산 및 PostgreSQL 검증, `npm run build`는 TypeScript 검사와 배포 파일 생성, `npm run preview`는 빌드 미리보기입니다.
휴대폰 카메라는 HTTPS 또는 브라우저가 신뢰하는 localhost 환경이 필요합니다. 실제 Pages 사이트는 HTTPS를 사용합니다.

데모 데이터만 `localStorage`의 `study-hall-fictional-demo`에 저장합니다. 데모 QR은 브라우저에 저장되어 유지됩니다. 데모 코드·세션은 현재 탭의 메모리에 있어 새로고침하면 다시 로그인해야 합니다. 데모 재발급 코드는 새로고침 후 유지되지 않습니다. 기본 코드가 데모 진입점으로 돌아옵니다. 데모에서는 교사 QR 화면을 열고 같은 탭에서 로그아웃→학생 로그인→스캔 화면의 **현재 데모 QR로 시연**을 실행할 수 있습니다. 실제 카메라 스캔과 서버 저장은 운영 모드에서 별도 확인하세요. 데모를 개인정보 운영에 사용하지 마세요.

## 구현된 기능

- 학생: 코드 로그인, 오늘 날짜·수능 D-day, 현재 입실/오늘 중복 없는 출석 인원, 본인 상태·이용 시간, 현장 QR 카메라, 자기 좌석 강조, 본인 기록·통계, 중요 공지, 비공개 건의와 답변.
- 교사: Supabase 이메일·비밀번호 로그인, 학생 등록/정보 수정/중지, 무작위 코드 발급·재발급, 수동 입퇴실과 사유, 기록 시각 수정과 감사 이력, 좌석 위치·사용 가능 여부·직접 배정, 선택/고정/재추첨/미리보기 조정/확정, 공지 CRUD, 건의 답변·상태, 기간별 통계와 CSV, 정원·수능일·누락 기준·운영일·출석 대상 설정.
- 한국 시각의 자정 경계를 분할하여 합산; 주간은 월~일. 진행 중인 시간은 확정 시간과 별도 표시. 설정 시간을 초과한 미퇴실 구간은 확인 필요이며 확정·진행 합계에서 제외합니다. 임의 자동 퇴실은 없습니다.
- 운영일/대상/기준 시각이 모두 설정된 경우에만 지각·결석 판정. 결석은 운영 종료 후 판정. 일별 판정과 현재 입실 상태는 별개입니다.
- 15초마다 서버 데이터 조회. 변경 성공 시 즉시 갱신. CSV는 UTF-8 BOM과 셀 인용, 수식 시작 문자 앞 작은따옴표를 적용합니다.
- React 텍스트 렌더링으로 공지/건의 HTML을 실행하지 않습니다. 학생 공개 순위는 없습니다.

## 실제 Supabase 운영 설정

1. 별도 Supabase 프로젝트를 만들고 접속 URL과 **publishable 공개 키**를 확인합니다. 프로덕션과 테스트 프로젝트를 분리하세요.
2. Supabase CLI와 Docker를 설치합니다. CLI 명령은 이 폴더에서 실행합니다.

```text
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

CLI를 사용하지 않으면 SQL Editor에서 `supabase/migrations/`의 두 파일을 번호 순으로 한 번씩 실행해도 됩니다. 이 프로젝트에는 두 마이그레이션이 이미 적용되어 있습니다. 로컬 파일 버전은 실제 적용 기록에 맞춰 두었습니다. 이미 적용한 초기 마이그레이션을 다시 실행하지 마세요. 기존 프로젝트에 같은 이름의 테이블이 있다면 새 프로젝트를 사용하세요.
정원과 예시 72석만 생성되고 실제 학생은 없습니다. `supabase/demo-seed.sql`은 전용 테스트 프로젝트에서만 수동 실행하는 가상 명단입니다. 운영에는 실행하지 않습니다.

3. **최초 관리자**: Dashboard → Authentication → Users에서 교사의 이메일 계정을 만들고 이메일 확인을 완료합니다. 계정 UUID를 복사한 뒤 SQL Editor에서 다음을 실행합니다.

```sql
insert into public.admins(user_id) values ('AUTH_USER_UUID');
```

공개 회원가입을 꺼 두세요. 앱은 학생용 Supabase Auth 계정을 만들지 않으며 학생은 코드만 입력합니다. 교사 역할은 `admins` 테이블에서 서버가 매 요청 검사합니다. 가입 metadata를 역할 근거로 쓰지 않습니다. `admins`에 없는 Auth 사용자는 교사 로그인을 완료할 수 없습니다. 관리자 추가/삭제는 서버 운영자가 SQL Editor에서 수행합니다.

4. 두 번째 마이그레이션은 코드 검증용 비밀값을 DB 내부에서 무작위 생성하여 **Supabase Vault**에 암호화 보관합니다. 브라우저에는 비밀값을 반환하지 않으며 service_role 전용 `code_digest` RPC로 HMAC 해시만 계산합니다. 기본 운영에서는 별도 `CODE_PEPPER` 입력이 필요 없습니다. 기존 Edge Secrets 방식을 쓰는 배포는 `CODE_PEPPER`를 서버에 설정할 수 있으나, 이미 코드를 발급한 뒤 Vault와 Edge 방식 사이를 바꾸면 전체 코드 재발급이 필요합니다. 기본 허용 origin은 `https://fnsrbs.github.io,http://127.0.0.1:5173`이며 다른 호스트에서는 서버 `ALLOWED_ORIGINS`를 설정합니다. `ALLOWED_ORIGINS`는 쉼표로 구분한 정확한 origin, 예: `https://YOUR_NAME.github.io,http://127.0.0.1:5173`. URL의 저장소 경로와 끝 `/`를 넣지 않습니다. service_role 키는 Supabase의 서버 환경값만 사용합니다. 비밀값을 shell 인자/로그나 Git 파일에 적지 마세요.

```text
supabase functions deploy api
```

`supabase/config.toml`의 `verify_jwt=false`는 학생의 자체 세션 인증을 위한 설정입니다. Edge 함수가 교사 JWT를 `auth.getUser()`로 검증하고, 학생 세션은 DB에서 검증합니다. 이 설정만 복사하여 다른 함수의 인증을 끄면 안 됩니다.

5. 로컬 `.env`를 아래처럼 바꾸고 개발 서버를 다시 실행합니다.

```dotenv
VITE_APP_MODE=production
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

운영 모드를 명시했는데 키가 없으면 오류로 중단하며 데모로 자동 전환하지 않습니다. VITE 접두사가 붙은 값은 공개 번들에 포함됩니다. **관리자 비밀번호, CODE_PEPPER, service_role 키를 VITE 환경변수에 넣지 마세요.**

6. 교사로 로그인하여 실제 학생을 등록하고 코드를 개별 발급합니다. 코드는 한 번만 표시되므로 해당 학생에게 안전하게 전달하세요. 기록을 보존하려면 삭제 대신 이용 중지를 사용합니다. 좌석, 정원, 수능 날짜, 운영일과 출석 대상을 설정합니다.

## 서버와 데이터 보안

브라우저 → Edge `api` → service_role 전용 `app_api` RPC → Postgres로 처리합니다. 모든 노출 테이블은 RLS를 켜고 anon/authenticated 직접 접근을 취소했으며 제한 정책도 적용했습니다. 이 앱은 학생을 Supabase의 authenticated 역할로 가장하지 않습니다. 사용자별 범위는 Edge의 인증 결과와 RPC에서 확정한 세션 신원으로 결정됩니다. 클라이언트의 student_id는 학생 출결/건의/조회 신원으로 사용하지 않습니다. 학생 snapshot에는 다른 학생 이름·학번·배정·개별 기록·건의·출석 대상 UUID·코드 해시가 없습니다. 좌석 번호/위치와 전체 집계만 공개됩니다. 관리자 snapshot에도 코드 해시·세션·QR 검증용 DB 행은 없습니다.

신규 학생·교사 접속 코드는 영문 대문자와 숫자를 섞은 5자리 무작위 값이며, Vault 비밀키를 사용한 HMAC-SHA256만 검증 테이블에 저장합니다. I·O·0·1은 제외하고 학생·교사 간 현재 코드 중복을 검사합니다. 작은 학번 공간을 해시한 코드가 아닙니다. 256비트 세션 토큰은 SHA256 해시로 저장하고 8시간 만료되며, 코드 버전 변경 또는 이용 중지 시 기존 세션을 삭제합니다. 성공/실패를 포함하여 코드당 10회/10분, IP당 300회/10분을 DB 원자 연산으로 제한합니다. 학교 공유 NAT를 고려한 IP 한도입니다. 운영 gateway의 신뢰 가능한 `x-forwarded-for` 전달과 IP 위변조 방지는 배포 후 확인하세요. pepper 교체 시 전체 코드를 재발급해야 합니다.

현장 QR은 256비트 무작위 토큰이며 Vault에 암호화하여 보관하고 검증용 해시에는 만료를 두지 않습니다. 새로고침·재배포 후에도 유지됩니다. 교사 화면에서 QR 인쇄로 출력하고, QR 재발급을 누르면 기존 인쇄본은 즉시 무효화됩니다. 개인정보·관리자 키·URL을 담지 않으며 앱은 `SH1.` 뒤 64자리 hex 형식만 받습니다. 스캔 문자열로 외부 URL을 열지 않습니다. QR 전달/촬영 공유 때문에 현장 위치를 완벽하게 보장하지 않습니다.

출결은 학생 행 잠금, 요청 ID 잠금, 동일 학생의 열린 구간 partial unique index 및 트랜잭션으로 중복을 막습니다. 동일 요청 ID 재시도는 기존 결과를 반환하고, 새 ID의 중복 입실·선행 입실 없는 퇴실은 거부합니다. 입퇴실 시간은 Postgres 서버 시간입니다. 수정 시 전후 값·관리자 UUID·시각·사유를 남깁니다. 좌석 확정은 전역 트랜잭션 잠금과 unique seat_id로 보장되며 실패하면 전체 변경을 롤백합니다. 배정 이력은 `seat_history`, 변경 전후 이력은 `audits`에 저장합니다. UI 감사 목록은 최신 100건이며 전체 이력은 DB에 남습니다.

현재 조회는 72명 규모의 전체 원본을 역할 범위 안에서 가져옵니다. 장기 누적 시 페이지네이션/기간별 서버 조회가 필요할 수 있습니다. 출결 CSV의 기간 필터는 **입실 날짜** 기준이고 이용 통계는 자정 분할 후 **각 날짜** 기준입니다. 미퇴실 기록의 임시 시간은 확정 통계에 포함되지 않습니다. 이용 일수도 확정 구간이 있는 날짜 기준입니다. 퇴실 확인 필요의 현재 입실 상태는 교사가 실제 퇴실을 확인할 때까지 유지합니다.

## GitHub Pages 배포

현재 저장소는 https://github.com/fnsrbs/Jaseub 의 main 브랜치에 연결되어 있습니다. 상위 .gitignore는 앱과 배포·안내 파일만 등록하고 기존 명단·출력 파일을 제외합니다. 다른 저장소로 옮기는 경우 이 앱만 새 저장소의 루트로 복사하는 방식도 사용할 수 있습니다. `node_modules`, `dist`, `.env`, DB 백업을 복사하지 않습니다. 소스 zip에도 포함하지 않습니다.

새 저장소에 앱을 넣은 뒤:

```text
git init -b main
git add .
git commit -m "Add study hall attendance app"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

앱의 `.gitignore`와 실제 파일을 확인한 다음 추가하세요. 기존 상위 저장소에서 관리하는 경우 `study-hall/`과 상위 `.github/workflows/study-hall-pages.yml`만 선별하여 추가하세요. 기존 명단/출력 파일은 추가하지 않습니다.

- Repository → Settings → Pages → Source를 **GitHub Actions**로 설정합니다.
- Settings → Secrets and variables → Actions → **Variables**에 `VITE_APP_MODE` (`production` 또는 `demo`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 설정합니다. 서버 비밀키는 GitHub Pages 작업에 필요하지 않습니다.
- 새 저장소 루트에서는 `.github/workflows/pages.yml`이 자동 실행합니다. 기존 상위 저장소에서는 상위 workflow가 `study-hall`을 작업 디렉터리로 빌드합니다.
- 출력 URL은 `https://YOUR_NAME.github.io/YOUR_REPO/`. Vite base는 Actions의 저장소 이름으로 정해지고 모든 화면은 `#home`, `#records` 같은 hash 라우팅을 사용하므로 하위 경로/새로고침에 404 라우트 우회가 필요하지 않습니다.
- `YOUR_NAME.github.io` 루트 저장소 또는 사용자 도메인이라면 workflow의 `PAGES_BASE`를 `/`로 바꿉니다.
- 새로고침/브라우저 변경/재배포해도 운영 데이터는 Supabase에 남습니다. Auth/학생 세션은 각 브라우저에서 다시 로그인할 수 있습니다.

2026-10-14에 확인한 [GitHub 공식 Pages workflow 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)를 따릅니다. GitHub 업로드와 Pages의 GitHub Actions 방식 설정을 완료했습니다. 데모 주소는 https://fnsrbs.github.io/Jaseub/ 이며 배포 결과는 https://github.com/fnsrbs/Jaseub/actions 에서 확인합니다. 실제 Supabase 운영 연결은 별도입니다.

## 검증 범위

`npm test`의 30개 테스트(상위 DB·Edge 테스트 포함)는 PGlite PostgreSQL 엔진에 마이그레이션과 RPC를 실제 실행하여 RLS·직접 접근 차단·관리자 권한·학생 범위·건의 비공개·만료 QR·중복 요청·재입실·열린 구간 제약·좌석 중복/잘못된 좌석 롤백·감사 이력·재발급/중지/만료·로그인 제한을 검증하고, TypeScript 계산 테스트로 자정·주간·미확정·좌석 부족/고정/미리보기 분리·QR 형식·CSV를 확인합니다. PGlite에서는 hosted `pgcrypto` 로더만 대체하며 UUID는 같은 PostgreSQL `gen_random_uuid()`를 사용합니다.

PGlite의 병렬 호출은 단일 엔진에서 직렬화됩니다. **여러 실제 DB 연결의 동시 경합 및 Edge gateway 검증 완료를 의미하지 않습니다.** 이를 검증하는 `tests/hosted-e2e.mjs`를 별도로 제공합니다. 테스트 관리자와 빈/가상 학생 전용 Supabase 테스트 프로젝트에서, 아래 환경변수를 프로세스에 설정 후 실행합니다. 비밀번호를 파일·저장소에 기록하지 마세요.

```text
TEST_ONLY=YES
SUPABASE_URL=TEST_PROJECT_URL
SUPABASE_ANON_KEY=TEST_PUBLIC_KEY
TEST_TEACHER_EMAIL=TEST_ADMIN_EMAIL
TEST_TEACHER_PASSWORD=TEST_ADMIN_PASSWORD
node tests/hosted-e2e.mjs
```

동시 HTTP 입실 12건에서 1건 성공, 재전송, 재입실, QR 지속성·재발급 후 기존 QR 거부, 학생 범위와 권한, 재발급·중지 차단을 검사합니다. 테스트 학생 2명을 생성하고 마칠 때 중지하며 설정을 되돌립니다. 감사/출결은 테스트 프로젝트에 남깁니다. 실서비스 키·관리자 계정 없이 이 테스트를 실행한 것으로 보고하지 않습니다.

Edge 테스트는 실제 서버 소스를 번들해 HTTP 핸들러를 실행하며, Supabase 클라이언트만 모킹하여 origin·HTTP 메서드·익명/위조 JWT 거부·서버 신원 선택·평문 미저장·무작위 코드/QR/세션·시도 제한을 확인합니다. 실제 Auth 서버와 gateway 검증은 hosted 테스트 범위입니다.

## 백업·복구와 요금제

**CSV는 조회용 다운로드이며 전체 DB 백업/복구 수단이 아닙니다.** 공지·건의·좌석 이력·권한·세션·함수·제약·인덱스·RLS를 복구하지 못합니다.

2026-10-14 확인 기준 [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)는 Pro/Team/Enterprise의 일일 백업과 각각 7/14/30일 보존, Free의 별도 CLI 덤프 보관을 안내합니다. PITR은 유료 플랜의 추가 옵션입니다. 플랫폼 백업에서 Storage 실제 파일은 제외되고, 프로젝트 삭제 시 백업도 삭제됩니다. 본 앱은 Storage 업로드를 사용하지 않습니다.

Free는 [공식 요금표](https://supabase.com/pricing) 기준 DB 500MB, 월 egress 5GB, 비활성 1주 후 프로젝트 일시 중지 등의 제한이 있습니다. 최신 이용량·요금과 Edge 실행 한도는 운영 프로젝트 Dashboard와 공식 문서에서 다시 확인하세요. 학생 72명이라도 폴링과 누적 이력은 사용량을 발생시킵니다.

플랫폼 일일 백업이 있으면 Dashboard → Database → Backups에서 원하는 시점으로 복구합니다. 복구 중에는 서비스 중단이 필요하며 백업 이후 기록은 복구되지 않습니다. 먼저 별도 테스트 프로젝트에서 복구 연습을 하세요.

수동 논리 백업은 **저장소 밖의 접근 제한된 암호화 폴더**에서 진행합니다. CLI와 Docker가 필요하며 비밀번호/연결 URL은 환경이나 CLI 프롬프트로 입력합니다.

```text
supabase db dump --linked -f roles.sql --role-only
supabase db dump --linked -f schema.sql
supabase db dump --linked -f data.sql --data-only --use-copy
```

프로젝트 전체의 Auth/storage 등 관리 스키마와 migration history 포함 여부는 [공식 CLI 백업·복구 절차](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)를 따릅니다. 앱 public 스키마만 덤프하면 Auth 계정 복원까지 보장하지 않습니다. 원본 DB 비밀번호·server secrets·Auth 설정·Edge 소스/배포 설정도 별도 보관하고, 연결 URL·비밀값을 공개 로그에 남기지 마세요.

새 Supabase 프로젝트의 복구 대상 DB URL을 환경변수 `RESTORE_DB_URL`로 설정하고 Postgres CLI로 공식 절차에 따라 roles/schema/data를 순서대로 로드합니다. 아래는 POSIX 셸 예시이며 PowerShell에서는 `$env:RESTORE_DB_URL`을 사용합니다.

```sh
psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -f roles.sql
psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -f data.sql
```

이미 마이그레이션을 적용한 DB에 schema.sql을 다시 넣으면 충돌할 수 있습니다. 복구 경로 하나를 선택하여 공식 문서대로 새 프로젝트에 복구하세요. 복구 뒤 제약·인덱스·권한을 확인하고 Edge 함수·CODE_PEPPER·허용 origin·프런트 URL/키를 재설정합니다. 관리자 로그인, 학생 코드, 기록 수, 좌석 중복 제약 및 실제 입퇴실을 검증한 후 서비스를 전환합니다. Vault 비밀값은 암호화되어 있고 새 프로젝트에서 기존 암호문이 그대로 복호화된다고 보장할 수 없습니다. Vault 암호화 키의 별도 복구 절차도 [공식 Vault 문서](https://supabase.com/docs/guides/database/vault)를 따라야 합니다. 기존 pepper를 복구할 수 없으면 새 비밀값으로 전체 코드를 재발급해야 합니다. 복구 시 학생 세션을 삭제해 재로그인을 요구하는 것이 좋습니다.

SQL dumps/백업·실제 명단·학생 코드 목록·비밀키는 GitHub에 커밋하지 않습니다. 백업은 보존 기간, 암호화, 접근 권한, 정기 복구 검증을 함께 운영합니다.

## 학생·교사·관리자 로그인
학생은 개인 코드로 자신의 출결을 확인하고 QR로 입퇴실합니다. 교사는 조회 전용 코드로 전체 출결·좌석·공지·건의사항·통계를 봅니다. 관리자는 기존 Supabase 이메일·비밀번호로 로그인하여 모든 운영 기능을 관리합니다. 교사 코드 확인·재발급은 운영 설정에 있으며, 재발급 즉시 이전 코드와 교사 세션이 폐기됩니다. 교사 세션은 8시간 후 만료됩니다. 교사 코드는 Vault에 암호화하고 검증용 해시·버전만 별도 저장합니다. 모든 수정 API는 교사 세션에 대해 서버에서 거부됩니다.

학생 관리에서 확인된 남녀 구분을 개별 또는 선택 학생에게 일괄 적용할 수 있습니다. 좌석 재추첨에서 남학생·여학생을 각각 선택하고 원하는 좌석 구역을 지정합니다. 명단과 개인 코드는 GitHub에 포함하지 않습니다.

학생 관리의 코드 확인 기능은 현재 개인 코드를 관리자에게만 반환합니다. 평문은 Vault 암호화 상태로 보관하며 코드 확인 시 현재 검증 해시와 일치하는지도 검사합니다. 학생 삭제는 목록 제외·로그인 차단·좌석 해제를 수행하고 기존 출결을 보존합니다. 출결 기록 삭제는 사유를 요구하며 삭제 전 내용은 관리자 변경 이력에 보관합니다.

관리자 운영 설정 → 로그인 화면 문구 편집에서 큰 제목·설명·로그인 제목·안내·운영 모드 표시를 저장합니다. 저장된 문구는 로그인 전에도 공개 조회됩니다. 공개 API에는 문구 6항목만 반환하며 설정 변경은 관리자만 가능합니다. 5자리 로그인은 코드·IP 제한에 더해 전체 300회/10분 제한도 적용합니다.

### 좌석 선택과 경고카드

좌석 관리의 사용할 좌석 배치도에서 추첨 영역을 선택합니다. 칠판·교탁은 아래쪽이며 두 자리 책상 단위로 남학생끼리·여학생끼리 짝 배정 옵션을 켤 수 있습니다. 미확인 성별은 먼저 학생 관리에서 지정해야 합니다. 고정 및 미선택 학생의 자리는 보존하고, 조건을 만족할 수 없으면 배정하지 않습니다.

경고카드 메뉴에서 관리자가 학생과 사유를 지정하면 카드 1장이 누적됩니다. 발급 이력은 DB에 보관되며 중복 재전송은 같은 요청 UUID로 방지합니다. 교사는 전체 조회만, 학생은 자신의 카드만 조회합니다. 학생 관리에서도 누적 장수를 확인할 수 있습니다.

좌석 배치도와 사용할 좌석 선택 지도는 남학생을 파랑, 여학생을 분홍으로 표시합니다. 선택 여부는 초록 테두리·체크로 구분합니다. 경고카드 발급 내역에서 관리자가 삭제 사유를 입력해 카드를 삭제하면 모든 화면의 누적 장수에서 제외되며 원본·삭제 사유는 감사 이력에 보존됩니다.

좌석 관리 상단의 배치도에서 좌석을 클릭하면 학생/빈자리를 선택할 수 있습니다. 다른 좌석의 학생을 선택하면 두 학생을 교환하고, 미배정 학생을 선택하면 기존 학생은 미배정 상태가 됩니다. 빈자리를 선택하면 해당 학생의 배정이 해제됩니다. 추첨 후에도 배치도에서 연속 수정한 뒤 배정 변경 확정 버튼으로 일괄 저장합니다. 고정 학생은 먼저 고정을 해제해야 이동할 수 있습니다.

교사 코드 로그인 사용자는 경고카드 발급·삭제가 가능합니다. 경고카드 이외의 학생·출결·좌석·설정 편집은 관리자만 가능합니다. 교사는 공유 코드로 접속하므로 경고 이력에는 개인 이름 대신 교사 권한으로 기록됩니다. 학생 관리의 정렬 선택에서 학번 오름차순(기본)·내림차순·이름순을 사용할 수 있습니다.

교사 메뉴의 경고카드는 공지사항 바로 아래에 표시됩니다. 학생 조회 탭에서 학번순 명단을 검색하고 학생별 좌석·성별·이용 상태·현재 출결·누적 경고 및 상세 이용 통계/최근 출결/경고 내역을 읽기 전용으로 확인할 수 있습니다. 이용 통계는 학번을 표시하고 기본 학번 오름차순이며 정렬 선택과 CSV에도 같은 순서를 사용합니다.
