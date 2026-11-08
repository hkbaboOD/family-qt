# 우리 가족 큐티

가족이 같은 말씀을 읽고, 묵상과 기도제목을 함께 나누는 웹앱이에요.

**주소: https://hkbabood.github.io/family-qt/**

- 화면: 오늘(묵상) · 기도(기도제목) · 기록(달력·검색) · 말씀카드 · 가족(호칭·초대)
- 호스팅: GitHub Pages (`main`에 올리면 GitHub Actions가 자동 배포)
- 로그인·저장: Firebase 프로젝트 `family-qt-ce69e` (Google 로그인 + Firestore 서울 리전)
- 비용: 무료 요금제(GitHub Pages 공개 저장소, Firebase Spark)

## 쓰는 법

1. 아이폰 **사파리**로 주소를 열고 **Google로 계속하기**를 눌러요.
2. 처음 한 명이 **새 가족 만들기**에서 가족 이름과 호칭을 넣어요.
3. **가족** 탭 → **초대 링크 보내기**로 카카오톡에 링크를 보내요.
4. 가족은 링크를 열고 구글 로그인 → 호칭 입력 → **가족에 참여하기**.
5. 사파리 **공유 → 홈 화면에 추가**를 하면 앱처럼 쓸 수 있어요.

### 자주 막히는 곳

| 상황 | 해결 |
|---|---|
| 카카오톡에서 링크를 열었더니 로그인이 안 돼요 | 카카오톡 안의 브라우저는 구글 로그인을 막아요. 앱이 자동으로 바깥 브라우저로 넘겨 주고, 안 넘어가면 오른쪽 위 메뉴 → **다른 브라우저로 열기**를 누르세요. |
| 홈 화면 아이콘으로 열면 다시 로그인하래요 | 아이폰은 사파리와 홈 화면 앱의 로그인을 따로 보관해요. 홈 화면 앱에서 한 번 더 로그인하면 돼요. |
| "초대 링크가 맞지 않아요" | 가족을 만든 사람이 초대 링크를 새로 만들었을 수 있어요. 새 링크를 받아 주세요. |

## 고치고 다시 올리기

`public/` 폴더의 파일을 고쳐 `main`에 올리면 1~2분 뒤 자동으로 반영돼요.
보안 규칙(`firestore.rules`)을 바꿨다면 Firebase 콘솔 → Firestore → **규칙** 탭에 붙여 넣고 **게시**해야 해요.

## 폴더 구성

```
.github/workflows/pages.yml   GitHub Pages 자동 배포
firestore.rules               보안 규칙: 가족만 읽기·쓰기, 본인 글만 수정·삭제
firebase.json                 (선택) Firebase CLI로 규칙을 올릴 때 쓰는 설정
public/
  index.html  app.js          화면과 동작
  config.js                   Firebase 웹 설정 (공개돼도 되는 값)
  manifest.webmanifest icons/ 홈 화면 앱 설정과 아이콘
```

## 데이터 구조

```
families/{가족ID}                 이름, 만든 사람, 초대 코드
  members/{uid}                   호칭, 색, 이름
  entries/{날짜_uid}              가족과 나눈 묵상
  plans/{날짜}                    가족이 함께 읽을 본문
  prayers/{id}                    가족과 나눈 기도제목 (적은 날, 응답 날짜 포함)
  reactions/{id}                  아멘 · 함께 기도해요 · 댓글
users/{uid}                       내가 속한 가족
  entries/{날짜}                  나만 보기 묵상
  prayers/{id}                    나만 보기 기도제목
```
