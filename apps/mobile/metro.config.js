// API의 만세력 코드표(engine/tables.ts)와 라벨(rules/engine.ts)을 복제하지 않고 가져오기 위해 감시 폴더에 추가.
// 워크스페이스 모노레포로 바꾸면 Expo가 자동 설정하므로 이 파일은 지워도 된다.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../api/src')];

module.exports = config;
