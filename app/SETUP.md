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

4. **앱 → 플랫폼 키 → `Default JS Key`** 카드의 **JavaScript SDK 도메인**에 등록
   - `https://heehiii.github.io`
   - `http://localhost:8080` ← 없으면 로컬 테스트가 조용히 실패합니다
   - 입력 후 **맨 아래 저장** 까지 눌러야 반영됩니다

   > ⚠️ 옛 안내서에 나오는 "플랫폼 → Web" 메뉴는 없어졌습니다.
   > 이제 **키마다** 도메인을 붙이고, **REST API 키 카드에 등록하면 지도는
   > 그대로 안 뜹니다.** 반드시 JavaScript 키 카드에 넣으세요.

5. **제품 설정 → 카카오맵 → 사용 설정 ON** ← **가장 많이 빠뜨리는 단계**

   > 도메인만 등록하고 이걸 안 켜면 `sdk.js` 가 **401** 로 거부되고,
   > 화면에는 아무 설명 없이 지도만 안 뜹니다. 콘솔에만
   > `[지도] SDK 를 불러오지 못했습니다` 가 찍힙니다.
   >
   > 카카오가 2026년에 이용 절차를 바꾸면서 생긴 단계입니다.
   > → <https://developers.kakao.com/docs/ko/kakaomap/common>
   >
   > 첫 번째 앱은 무료 사용량이 붙습니다. 비즈월렛·결제수단은
   > **두 번째 앱부터** 필요하므로 지금은 신경 쓰지 않아도 됩니다.

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
6. **카카오 로그인 → 활성화 ON**
7. **Redirect URI** 등록 — **가장 많이 틀리는 곳**

   ```
   https://iprdjwxcqwtqvksponlg.supabase.co/auth/v1/callback
   ```

   > ⚠️ **GitHub 주소가 아니라 Supabase 주소입니다.**
   > `<프로젝트ref>` 는 Supabase Project URL 안의 영문자 덩어리입니다.

8. **보안 → Client Secret** 생성 → 코드 복사
9. **동의항목 → 닉네임**만 필수 동의
   - **이메일은 건드리지 마세요.** 비즈앱 전환이 필요해지는데 우리는 이메일을 쓰지 않습니다.

---

## 3. 둘을 잇기

10. Supabase → **Authentication → Providers → Kakao** 활성화
   - 카카오 **REST API 키** + **Client Secret** 붙여넣기
11. Supabase → **Authentication → URL Configuration**
    - Site URL: `https://heehiii.github.io/gangneung505/app/`
    - Redirect URLs 에 추가:
      - `https://heehiii.github.io/gangneung505/app/**`
      - `http://localhost:8080/**`

> ⚠️ 여기에 없으면 Supabase 가 사용자를 **조용히** 되돌려보내고 방이 안 만들어집니다.
> 오류 메시지가 안 떠서 찾기 어려운 증상입니다.

---

## 선택 — 짧은 링크 자동으로 풀기

`naver.me` 같은 **짧은 주소**를 붙여넣어도 위치를 찾아주게 하는 기능입니다.
**안 해도 됩니다** — 안 하면 지금처럼 "이름으로 검색 / 주소 붙여넣기 /
지도에서 찍기" 로 동작합니다.

> **왜 서버가 필요한가**: 짧은 주소는 열어봐야 진짜 주소를 알 수 있는데,
> 브라우저는 보안상 남의 사이트의 응답 헤더를 읽을 수 없습니다.
> 그래서 작은 서버 조각이 대신 따라가 줍니다. 페이지 내용은 받지 않고
> **"어디로 넘어가는지"만** 봅니다.

### 1) 표 하나 더 만들기

[`0007_resolve.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/migrations/0007_resolve.sql)
을 SQL Editor 에 붙여넣고 Run.

### 2) 함수 올리기

Supabase 왼쪽 메뉴 **Edge Functions** → **Deploy a new function** →
**Via Editor** (브라우저에서 바로 쓰는 방식)

- 이름은 아무거나 괜찮습니다 (나중에 설정에 적어줍니다)
- **편집기에 있던 예제 코드를 전부 지우고**,
  [**`bundled.ts`**](https://github.com/HEEHiii/gangneung505/blob/main/supabase/functions/resolve-link/bundled.ts)
  내용을 통째로 붙여넣기 — **한 파일이면 됩니다**
- **Deploy**

> ⚠️ **기본 예제 코드를 꼭 지우세요.** 안 지우면 함수는 올라가지만
> `Hello undefined` 만 돌려줍니다. 실제로 이것 때문에 한참 헤맸습니다.

### 2-1) 함수의 진짜 이름 확인

올린 뒤 그 함수를 열고 **주소창**을 보세요:

```
.../functions/여기가-진짜-이름/details
```

`app/assets/config.js` 의 `RESOLVE_FN` 에 그 이름을 적습니다.

> Supabase 는 **한 번 정한 함수 이름을 못 바꿉니다.** 설정 화면의
> `Name` 을 고쳐도 "slug and endpoint URL will remain the same" 이라고
> 쓰여 있듯 **주소는 그대로**입니다. 그래서 이름을 맞추는 대신
> 설정 한 줄을 고치는 쪽이 쉽습니다.

### 2-2) Verify JWT 끄기

같은 화면 **Settings → Verify JWT with legacy secret → 끄기**

> 꺼도 안전합니다. 실제로 막는 건 **방 토큰 확인**(데이터베이스가
> 합니다)과 **허용 사이트 목록**, **한 방 시간당 20번** 제한입니다.
> JWT 검사는 "로그인한 사람인가"만 보는데, 우리 친구들은 애초에
> 로그인을 하지 않습니다.
>
> 켜두면 브라우저의 사전 확인 요청(OPTIONS)이 막혀서, **함수가
> 실행조차 안 되고 로그도 안 남습니다.**

### 3) 확인

숙소 추가 칸에 `naver.me/...` 링크를 붙여넣고 **찾기**.
바로 지도에 뜨면 성공입니다.

안 되면 그냥 두셔도 됩니다 — **한 번 실패하면 그 뒤로는 시도하지 않고**
이름 검색·주소 붙여넣기로 조용히 넘어갑니다.

### 안전장치

이 함수는 주소만 알면 누구나 부를 수 있어서, 막아두지 않으면 **아무
주소나 대신 긁어주는 서버**가 됩니다. 그래서:

- 진짜 방 토큰이 있어야 하고, 한 방에 **한 시간 20번**까지
- **허용한 사이트**(네이버·카카오·구글 지도)만
- IP 를 직접 적은 주소, 사설망, `localhost`, `file://` 전부 거부
- 3초 넘으면 포기, 넘어가기는 4번까지
- 돌려주는 건 **좌표와 이름뿐** — 페이지 내용은 절대 안 보냄

일부러 공격해보는 검사 20여 가지가 `tests/resolve.check.mjs` 에 있습니다.

---

## 선택 — 사진 갤러리 (Cloudflare R2)

여행 사진을 모아두는 기능입니다. **안 해도 됩니다** — 안 하면 사진 탭이
"이 브라우저에만 저장" 모드로 돌아갑니다 (혼자 눌러볼 수는 있지만
친구들에게는 안 보이고 30장까지).

> **왜 Supabase 말고 Cloudflare 인가**
>
> 사진은 이 서비스에서 **유일하게 진짜 돈이 드는 부분**입니다.
> 휴대폰 사진 한 장이 3~5MB 이고 Supabase 무료 저장소는 1GB 라,
> 서비스 전체에서 200~300장이면 끝납니다. 더 큰 문제는 보는 쪽이에요 —
> 월 5GB 전송 제한에서 친구 10명이 사진 30장짜리 방을 한 번 보면
> 75MB, 즉 **월 65번 보면 소진**됩니다.
>
> Cloudflare R2 는 **10GB 무료**에 **보는 것이 무료**라 사진에는
> 사실상 정답입니다.

### 1) 표 만들기

[`0008_photos.sql`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/migrations/0008_photos.sql)
을 SQL Editor 에 붙여넣고 Run.

### 2) Cloudflare 준비 (약 15분)

1. [cloudflare.com](https://dash.cloudflare.com) 가입
2. 왼쪽 **R2** → **Create bucket**
   - 이름: 아무거나 (예: `trip-photos`)
   - **Location: Asia-Pacific** 권장
3. 그 버킷 → **Settings** → **Public access**
   - **Custom Domain** 을 붙이거나, **R2.dev subdomain** 을 켭니다
   - 나오는 주소(예: `https://pub-xxxx.r2.dev`)를 복사해두세요
4. R2 첫 화면 → **Manage API tokens** → **Create API token**
   - 권한: **Object Read & Write**, 그 버킷만
   - 나오는 **Access Key ID** 와 **Secret Access Key** 를 복사
     (Secret 은 **한 번만** 보여줍니다)
5. **Account ID** 도 복사 (R2 화면 오른쪽에 있습니다)

### 3) Supabase 에 열쇠 넣기

**Edge Functions → Secrets** 에서 네 개를 추가합니다:

| 이름 | 값 |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_BUCKET` | 버킷 이름 |
| `R2_ACCESS_KEY_ID` | Access Key ID |
| `R2_SECRET_KEY` | Secret Access Key |

> ⚠️ 이 네 개는 **진짜 비밀**입니다. `config.js` 에 넣으면 안 됩니다.
> 브라우저로 내려가면 누구나 우리 저장소에 아무거나 올릴 수 있습니다.

### 4) 함수 올리기

**Edge Functions → Deploy a new function → Via Editor**

- 예제 코드를 **전부 지우고**
  [`photo-upload-url/index.ts`](https://github.com/HEEHiii/gangneung505/blob/main/supabase/functions/photo-upload-url/index.ts)
  붙여넣기 (한 파일입니다)
- **Deploy** 후 **Settings → Verify JWT 끄기**
- 주소창의 `/functions/<이름>/details` 에서 **진짜 이름** 확인

### 5) config.js 채우기

```js
export const R2_PUBLIC_BASE = "https://pub-xxxx.r2.dev";   // 3번에서 복사한 주소
export const PHOTO_FN = "photo-upload-url";                 // 4번의 진짜 이름
```

### 올리기 전에 알아두실 것

사진은 **올릴 때 자동으로 줄입니다** — 긴 변 1600px, 목록용은 400px.
그러면 전송량이 20분의 1이 되고, 더 중요하게는 **사진에 박힌 촬영
위치(GPS)가 지워집니다.**

> 휴대폰 사진에는 찍은 자리의 좌표가 들어 있습니다. 숙소에서 찍은
> 사진을 그대로 올리면 **숙소 위치가 좌표까지 공개**됩니다. 링크를
> 가진 누구나 볼 수 있는 방인데요. 줄이는 과정에서 그게 사라집니다.
>
> 좌표를 박은 사진으로 실제 확인한 검사가
> `tests/photo.spec.mjs` 에 있습니다.

한 방에 **300장**까지입니다.

---

## 흔한 실수 세 가지

| 틀리기 쉬운 것 | 맞는 것 | 증상 |
|---|---|---|
| 카카오맵 **사용 설정**을 안 켬 | 제품 설정 → 카카오맵 → ON | 지도만 조용히 안 뜸 (401) |
| 도메인을 **REST API 키** 카드에 등록 | **JavaScript 키** 카드에 | 위와 똑같음 |
| 도메인 입력만 하고 **저장**을 안 누름 | 맨 아래 저장 | 위와 똑같음 |
| REST API 키를 `KAKAO_JS_KEY` 에 | **JavaScript 키** | 지도 안 뜸 |
| Redirect URI 에 GitHub 주소 | **Supabase 콜백 주소** | KOE006 |
| `service_role` 키를 config.js 에 | **`anon` / publishable 키** | 누구나 전체 삭제 가능 |
| Client ID 복사할 때 **제목까지** 긁힘 | 값만 (`Ov23...`) | 로그인 화면이 404 |
| Supabase provider 켜고 **Save** 안 누름 | Save 후 새로고침해 확인 | `provider is not enabled` |

> 위 세 줄은 **증상이 전부 같습니다** — "지도만 안 뜸". 그래서 하나씩
> 지워가며 확인해야 합니다. 콘솔(F12)에 `[지도] SDK 를 불러오지
> 못했습니다` 가 찍히면 셋 중 하나입니다.

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
