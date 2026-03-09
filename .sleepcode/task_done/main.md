# 완료 기록

- [x] package.json의 버전을 적절한 값으로 수정하고 npm publish까지 진행해줘. <!-- notion:31bad790-3b5d-80fd-988e-cd501c48546f -->
- [x] package.json의 버전을 적절한 값으로 수정하고 npm publish까지 진행해줘. <!-- notion:31bad790-3b5d-80fd-988e-cd501c48546f -->
- [x] 노션 DB의 priority 컬럼은 어떤 역할을 하고 있어? 그리고 이 값이 실제로 영향을 주고 있어? <!-- notion:31cad790-3b5d-80fd-a9f1-e42b533dcab5 -->
- [x] sleepcode를 실행할 때, 비용(cost)를 집계해서 보여주고 있잖아. 이거 비용 말고, ‘사용한 토큰’ 뭐 이런 명칭으로 바꿔야할듯. 그리고 provider별로 사용한 토큰을 따로 보여줘야할듯. <!-- notion:31cad790-3b5d-8072-90ba-de8c46168655 -->
- [x] 슬립코드 노션 db 구조에서 ‘Cost’의 명칭을 ‘Tokens’로 바꿔줘 <!-- notion:31cad790-3b5d-8002-b70b-df47c4ebcdfa -->
- [x] claude 응답 json 데이터에서 ‘message’ > ‘usage’에 사용한 토큰을 알려주는데, 이 값을 터미널 대시보드에 실시간으로 집계해줘. 최종적으로 사용한 총 토큰양은 노션 db의 Tokens 컬럼에 기입하는 로직도 추가해줘. 총 토큰양 계산 과정을 노션 db task 페이지의 ai report에 포함해줘 <!-- notion:31cad790-3b5d-80e3-8b76-fd3a57c5f9f2 -->
- [x] 슬립코드 사용 시 task 작업 끝난 후 노션 DB task 페이지에 자동으로 글을 써주고 있잖아.  AI Report 이후에, 실제로 한 작업들에 대한 내용은 노션화(?) 되어있지 않고 문자열 그대로 들어가는 문제가 있어. (예시 자료 함께 첨부) <!-- notion:31cad790-3b5d-8055-b3f2-f48108b8e01b -->
- [x] package.json의 버전을 적절한 값으로 수정하고 npm publish까지 진행해줘. <!-- notion:31bad790-3b5d-80fd-988e-cd501c48546f -->
- [x] 슬립코드 사용자 입장에서, 노션 db 스키마에 'difficulty' 컬럼을 추가해줘(1부터 5까지만 선택 가능해야됨). 그리고 sleepcode run으로 task를 실행하기 전 그 task의 난이도를 결정할 때, 노션 db에 그 task의 difficulty 컬럼에 값이 채워져 있을경우 그 값을 바로 갖다쓰도록 해줘.
- [x] task가 완료 된 후 노션 DB의 해당 task의 페이지에 AI Report 같은거 쓰고 있잖아. 여기에 버그 있음: 다른 task들의 AI Report 내용들을 포함하여 AI Report가 작성되는 문제 수정
- [x] Codex도 모델별 가격표 기반 환산 로직을 넣어줘
