# 온실 · 자습실 출결 및 좌석 관리

가상 학생 72명으로 실행할 수 있는 React·TypeScript·Vite 앱입니다. 실제 운영은 Supabase Auth·Postgres·Edge Functions를 사용합니다.

- [전체 설치·Supabase·관리자 등록·백업 안내](study-hall/README.md)
- [검증 결과와 운영 전 확인 사항](study-hall/VERIFICATION.md)
- [GitHub Actions 배포 상태](https://github.com/fnsrbs/Jaseub/actions)
- 데모 배포 주소: https://fnsrbs.github.io/Jaseub/ (최초 Pages 배포 성공 후 접속 가능)

## 로컬 실행

```sh
cd study-hall
npm ci
npm run dev
```

학생 코드: `DEMO-STUDENT-0001`. 교사 탭은 데모 로그인으로 가상 명단을 관리합니다.

## 배포와 운영 모드

GitHub Pages Source를 **GitHub Actions**로 설정하면 `main` 변경 시 테스트와 빌드 후 배포합니다. 저장소 하위 경로와 hash 라우팅을 사용합니다.

기본은 데모 모드입니다. 실제 운영은 Supabase를 먼저 설정하고 Repository → Settings → Secrets and variables → Actions → Variables에서 `VITE_APP_MODE=production`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 설정한 뒤 workflow를 실행하세요. 서버 비밀키는 Supabase에만 설정합니다.

이 저장소는 앱 소스와 배포 설정만 포함합니다. 실제 명단·출력 파일·DB 백업·개인 코드·비밀키는 업로드하지 않습니다.
