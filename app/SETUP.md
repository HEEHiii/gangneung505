# 설정 순서

채울 곳은 **`app/assets/config.js` 세 줄**뿐입니다.
전부 공개되어도 되는 값이라 깃허브에 올라가도 괜찮습니다.

> **지금 안 해도 됩니다.**
> 비워두면 "이 브라우저에만 저장" 모드로 전부 돌아갑니다.
> 지도 키가 없으면 지도 자리에 안내판이 뜨고 목록·투표는 그대로 됩니다.

---

## 1. Supabase — 데이터 저장소 (약 10분)

### 프로젝트 만들기
1. [supabase.com](https://supabase.com) 가입 (GitHub 계정으로 가능)
2. **New project**
   - Name: 아무거나 (예: `trip`)
   - Database Password: 자동 생성 (우리는 안 씁니다)
   - **Region: `Northeast Asia (Seoul)`** ← 속도 때문에 중요
3. 생성에 2~3분

### 주소와 키 복사

**Project Settings → 왼쪽 사이드바의 `API Keys`**

> ⚠️ **`General` 페이지에는 키가 없습니다.** Supabase 가 메뉴를 옮겼습니다.
> `JWT Keys` 도 아닙니다. **`API Keys`** 입니다.

| Supabase 화면 | `config.js` |
|---|---|
| **anon** `public` (또는 **Publishable key** `sb_publishable_…`) | `SUPABASE_ANON_KEY` |

> ⚠️ 같은 페이지의 **`service_role`** / **Secret key** 는 **절대 쓰지 마세요.**
> 모든 보안을 무시하는 키라서 브라우저에 넣으면 누구나 전체 데이터를 지울 수 있습니다.

**`SUPABASE_URL`** 은 **General 페이지의 Project ID** 로 바로 만들 수 있습니다:

```
https://<ProjectID>.supabase.co
```

#### 이 프로젝트의 실제 값

이미 만들어두신 프로젝트 기준입니다 (2026-11-19 확인):

```js
export const SUPABASE_URL = "https://iprdjwxcqwtqvksponlg.supabase.co";
```

그리고 **나중에 카카오에 넣을 Redirect URI** 도 지금 확정됩니다. 미리 복사해두세요:

```
https://iprdjwxcqwtqvksponlg.supabase.co/auth/v1/callback
```

### 표 만들기
**SQL Editor → New query** 에서 **순서대로** 실행:

1. `supabase/migrations/0001_schema.sql` 내용 **전체** → Run
2. 새 query 열고 `supabase/migrations/0002_rpc.sql` **전체** → Run

둘 다 Success 면 끝. 여러 번 실행해도 안전합니다.

---

## 2. 카카오 — 지도와 로그인 (약 10분)

### 앱 만들기
1. [developers.kakao.com](https://developers.kakao.com) 카톡 계정으로 로그인
2. **내 애플리케이션 → 애플리케이션 추가하기**
3. **앱 키 → JavaScript 키** → `config.js` 의 `KAKAO_JS_KEY`

> ⚠️ 옆에 있는 **REST API 키가 아닙니다.** 지도는 JavaScript 키만 받습니다.

4. **플랫폼 → Web → 사이트 도메인**에 **둘 다** 등록
   - `https://heehiii.github.io`
   - `http://localhost:8080` ← 없으면 로컬 테스트가 조용히 실패합니다

### 카카오 로그인
5. **카카오 로그인 → 활성화 ON**
6. **Redirect URI** 등록 — **가장 많이 틀리는 곳**

   ```
   https://iprdjwxcqwtqvksponlg.supabase.co/auth/v1/callback
   ```

   > ⚠️ **GitHub 주소가 아니라 Supabase 주소입니다.**
   > `<프로젝트ref>` 는 Supabase Project URL 안의 영문자 덩어리입니다.

7. **보안 → Client Secret** 생성 → 코드 복사
8. **동의항목 → 닉네임**만 필수 동의
   - **이메일은 건드리지 마세요.** 비즈앱 전환이 필요해지는데 우리는 이메일을 쓰지 않습니다.

---

## 3. 둘을 잇기

9. Supabase → **Authentication → Providers → Kakao** 활성화
   - 카카오 **REST API 키** + **Client Secret** 붙여넣기
10. Supabase → **Authentication → URL Configuration**
    - Site URL: `https://heehiii.github.io/gangneung505/app/`
    - Redirect URLs 에 추가:
      - `https://heehiii.github.io/gangneung505/app/**`
      - `http://localhost:8080/**`

> ⚠️ 여기에 없으면 Supabase 가 사용자를 **조용히** 되돌려보내고 방이 안 만들어집니다.
> 오류 메시지가 안 떠서 찾기 어려운 증상입니다.

---

## 흔한 실수 세 가지

| 틀리기 쉬운 것 | 맞는 것 |
|---|---|
| REST API 키를 지도에 | **JavaScript 키** |
| Redirect URI 에 GitHub 주소 | **Supabase 콜백 주소** |
| `service_role` 키를 config.js 에 | **`anon` 키** |

---

## 다 되면 확인하기

```bash
bash tests/run-all.sh
```

5개 묶음이 전부 통과하면 정상입니다.

브라우저로 직접 보려면:

```bash
python3 -m http.server 8080
```

그리고 `http://localhost:8080/app/index.html` 을 엽니다.
(ES 모듈이라 파일을 더블클릭하면 안 열립니다 — 웹서버가 필요합니다.)

---

## 참고: 기존 505 강릉여행 사이트

새 서비스는 `/app/` 아래에만 있고, 루트의 505 사이트는 **건드리지 않았습니다.**
친구들이 가진 링크가 그대로 살아 있습니다.

다만 0단계 보안 보강을 적용하려면 **앱스 스크립트를 재배포**해야 합니다.

1. 먼저 페이지(`assets/store.js`)를 올리고
2. 그다음 앱스 스크립트: **배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포**

순서가 중요합니다. 거꾸로 하면 친구 브라우저에 캐시된 옛 파일 때문에
삭제와 일정 저장이 잠깐 실패할 수 있습니다.

그리고 **구글 시트 사본을 하나 떠두세요.** 30초고 제일 수지 맞습니다.
