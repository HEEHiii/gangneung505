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

여행방·장소·투표를 담을 **빈 표**를 만드는 단계입니다.
긴 글이 적힌 파일 3개를 **순서대로** 복사해서 붙여넣고 실행하면 끝입니다.

왼쪽 메뉴 **SQL Editor** → **New query**

아래 링크를 열고 오른쪽 위 **복사 아이콘(Copy raw file)** 을 누른 뒤,
SQL Editor 에 붙여넣고 **Run** (또는 Ctrl+Enter):

| 순서 | 파일 | 하는 일 |
|---|---|---|
| 1 | [`0001_schema.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/migrations/0001_schema.sql) | 표를 만듭니다 |
| 2 | [`0002_rpc.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/migrations/0002_rpc.sql) | 방 만들기·입장·투표 기능 |
| 3 | [`0003_room_peek.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/migrations/0003_room_peek.sql) | 비밀번호 화면에 여행 이름 띄우기 |

**하나씩, 순서대로** 하세요. 2번이 1번의 표를 쓰고 3번이 2번을 쓰기 때문에
순서가 바뀌면 "없는 표입니다" 오류가 납니다.

매번 **New query** 로 새 창을 여는 게 안전합니다 (앞 내용이 섞이지 않게).

셋 다 **Success. No rows returned** 가 뜨면 정상입니다.
결과가 비어 있는 게 맞습니다 — 표를 "만드는" 명령이라 보여줄 내용이 없습니다.

여러 번 실행해도 안전하니, 중간에 헷갈리면 1번부터 다시 하셔도 됩니다.

### 제대로 들어갔는지 확인 (30초)

> SQL Editor 는 중간에 멈춰도 앞부분까지는 저장합니다.
> 그래서 **Success 를 봤어도 뒷부분이 빠졌을 수 있고**, 그 상태로는
> 나중에 방을 만드는 순간에야 터집니다. 먼저 걸러내는 게 낫습니다.

[`supabase/check.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/check.sql)
을 복사해 **New query** 에 붙여넣고 Run.

표가 하나 나오고 **열 줄이 전부 ✅ 면 정상**입니다.
❌ 가 있으면 설명 칸에 뭐가 빠졌는지 이름이 찍힙니다 — 그 파일만 다시 Run 하세요.

아무것도 바꾸지 않고 읽기만 하므로 몇 번을 돌려도 안전합니다.

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

### ⚠️ 카카오 로그인은 지금 막혀 있습니다 (KOE205)

**지도는 됩니다. 로그인만 안 됩니다.** 둘은 다른 제품입니다.

Supabase 의 카카오 로그인은 닉네임·프로필사진·**이메일** 세 가지를 항상
요구하도록 고정돼 있고 우리가 끌 수 없습니다. 그런데 카카오에서 이메일은
**비즈앱(사업자 인증)** 을 해야 열립니다. 그래서 개인 개발자는 막힙니다.

→ [supabase/supabase#36878](https://github.com/supabase/supabase/issues/36878)

**그래서 기본값이 구글입니다.** `app/assets/config.js` 의 한 줄로 바꿉니다:

```js
export const LOGIN_PROVIDER = "google";   // "github" | "kakao"
```

> 로그인하는 사람은 **방을 만드는 사람 한 명뿐**입니다. 친구들은 로그인
> 화면을 아예 안 봅니다. 그래서 여기를 뭘로 두든 친구들 경험은 같습니다.

**카카오로 되돌리려면**: `앱 → 일반 → 비즈니스 정보` 에서
**[개인 개발자 비즈 앱 전환]** (사업자등록번호 없이 전화번호 본인인증으로
가능) → 이메일 동의항목 권한 신청 → 승인되면 동의항목에서 **프로필 사진**과
**카카오계정(이메일)** 을 켜고 위 한 줄을 `"kakao"` 로.

아래 5~8번은 그때 하시면 됩니다.

### 카카오 로그인 (비즈앱 전환 후)
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

## 4. 키를 파일에 넣기

받은 키 두 개를 **`app/assets/config.js`** 에 적으면 끝입니다.
컴퓨터에 뭘 설치할 필요 없이 **깃허브 사이트에서 바로** 고칠 수 있습니다.

1. <https://github.com/HEEHiii/gangneung505/blob/main/app/assets/config.js> 열기
2. 오른쪽 위 **연필 ✏️** 아이콘
3. 따옴표 사이에 붙여넣기 — **세 줄만** 고칩니다

```js
export const SUPABASE_URL = "https://iprdjwxcqwtqvksponlg.supabase.co";
export const SUPABASE_ANON_KEY = "여기에 anon 키";
export const KAKAO_JS_KEY = "여기에 JavaScript 키";
```

4. 초록색 **Commit changes** 버튼

1~2분 뒤 사이트에 반영됩니다.

> 이 값들이 깃허브에 그대로 보여도 괜찮습니다.
> 브라우저가 알아야 작동하는 값이라 원래 숨길 수가 없고,
> 카카오는 **도메인 등록**으로, Supabase 는 **표 접근 차단**으로 따로 막혀 있습니다.
>
> ⚠️ 다만 **`service_role` 키와 카카오 `Client Secret` 은 여기 넣으면 안 됩니다.**
> 그 둘은 Supabase 설정 화면 안에만 있어야 합니다.

---

## 다 되면 확인하기

<https://heehiii.github.io/gangneung505/app/> 를 엽니다.

| 보이는 것 | 뜻 |
|---|---|
| 첫 화면에 지도 선택과 폼이 뜬다 | 페이지 정상 |
| 지역을 고르면 **지도가 뜬다** | 카카오 JS 키 ✅ |
| "방 만들기" 를 누르면 **카카오 로그인 창** | 카카오 로그인 ✅ |
| 로그인 후 **공유 링크가 나온다** | Supabase ✅ **1단계 완성** |

### 안 되면 어디가 문제인지

- **지도 자리에 안내판만** → 카카오 JS 키가 비었거나, 플랫폼 도메인에
  `https://heehiii.github.io` 를 안 넣었습니다
- **"이 브라우저에만 저장" 이라고 뜬다** → `SUPABASE_URL` 또는 `SUPABASE_ANON_KEY` 가 비었습니다
- **로그인하고 돌아왔는데 아무 일도 안 일어난다** → Supabase 의
  **URL Configuration** 에 Redirect URLs 를 안 넣었습니다 (3번 항목)
- **"로그인이 필요해요" 만 반복** → Supabase 의 Kakao Provider 가 꺼져 있거나
  REST 키·Client Secret 이 틀렸습니다

---

## 참고: 기존 505 강릉여행 사이트

새 서비스는 `/app/` 아래에만 있고, 루트의 505 사이트는 **건드리지 않았습니다.**
친구들이 가진 링크가 그대로 살아 있습니다.

다만 0단계 보안 보강을 적용하려면 **앱스 스크립트를 재배포**해야 합니다.
(페이지는 이미 `main` 에 올라갔으므로 순서는 맞습니다 — 아래 참고)

### 앱스 스크립트가 뭔가요

505 사이트는 친구들 **투표·경비·일정을 구글 시트에 저장**합니다.
그 시트에 작은 프로그램이 붙어 있어서, 사이트와 시트 사이를 중계합니다.
그게 **앱스 스크립트**입니다. 처음 만들 때 한 번 설정하고 그 뒤로는
볼 일이 없어서, 기억 안 나는 게 정상입니다.

### 재배포 순서

**0. 시트 사본 뜨기** (30초, 제일 수지 맞음)
구글 시트에서 **파일 → 사본 만들기**. 뭐가 잘못돼도 되돌릴 수 있습니다.

**1. 새 코드 복사**
<https://github.com/HEEHiii/gangneung505/blob/main/apps-script/Code.gs>
→ 오른쪽 위 **복사 아이콘(Copy raw file)**

**2. 편집기 열기** — 시트를 거칠 필요 없습니다
<https://script.google.com> 접속 (505 만들 때 쓴 **구글 계정**으로)
→ 목록에서 `505 강릉여행 데이터` 비슷한 이름의 프로젝트 클릭

**3. 붙여넣기**
기존 코드 전부 선택(Ctrl+A) → 지우고 → 붙여넣기(Ctrl+V) → 저장(Ctrl+S)

**4. 재배포** ← 여기가 핵심

> ⚠️ **"새 배포"를 누르면 안 됩니다.** 주소가 새로 생겨서
> `assets/store.js` 의 `ENDPOINT` 와 어긋나고, 친구들 투표가 저장되지 않습니다.

**배포** 옆 화살표 → **배포 관리** → 기존 배포의 **연필 ✏️**
→ **버전: 새 버전** → **배포**

주소는 그대로 유지됩니다.

### 잘 됐는지 확인

강릉 사이트에서 **경비를 하나 추가했다 삭제**해보세요.

- 삭제되면 성공 ✅
- "권한이 없어요" 가 뜨면 → 브라우저에 옛 페이지가 캐시된 것.
  **Ctrl+Shift+R** (폰은 새로고침 두세 번)

### 순서가 왜 이런가요

지금 배포된 앱스 스크립트는 **모르는 필드를 무시**합니다.
그래서 페이지가 먼저 올라가도 아무것도 깨지지 않습니다.
거꾸로 했다면 친구 브라우저에 캐시된 옛 페이지가 토큰을 안 보내서
삭제와 일정 저장이 잠깐 실패했을 겁니다.

### 급한 일인가요

아닙니다. 주소를 아는 사람이 없으면 아무 일도 안 일어납니다.
저장소가 공개라 봇이 긁어갈 가능성을 막아두자는 것이고,
**1월 여행 계획은 지금 그대로도 멀쩡히 돌아갑니다.**
