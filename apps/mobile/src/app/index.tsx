// 시작 로딩 화면: 로고를 보여 주는 동안 로그인 상태를 확인한다.
// 로그인돼 있으면 → 사주 정보 입력, 로그아웃 상태면 → 로그인 화면
import { useEffect } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fetchMe } from '../lib/saju';

const LOGO = require('../../assets/images/logo.jpg'); // 760px JPEG 67KB (같은 크기 PNG는 620KB)
const MIN_SPLASH_MS = 1200; // 로고가 번쩍 보였다 사라지지 않도록 최소로 보여 주는 시간

export default function StartScreen() {
  // Google 로그인 콜백이 실패 · 취소로 돌아올 때 붙이는 ?login= 을 다음 화면으로 넘긴다
  const { login } = useLocalSearchParams<{ login?: string }>();
  const { width, height } = useWindowDimensions();
  const size = Math.min(width * 0.62, height * 0.5, 340);

  useEffect(() => {
    let cancelled = false;
    const wait = new Promise(resolve => setTimeout(resolve, MIN_SPLASH_MS));
    Promise.all([fetchMe(), wait]).then(([me]) => {
      if (cancelled) return;
      const query = login ? `?login=${encodeURIComponent(login)}` : '';
      router.replace(me ? `/input${query}` : `/login${query}`);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={st.screen} accessibilityLabel="불러오는 중" accessibilityRole="progressbar">
      <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel="사주 四柱" />
    </View>
  );
}

const st = StyleSheet.create({
  // 로고 이미지 가장자리 색(#FEFEFE)과 같게 해 로고 둘레에 네모 경계가 보이지 않게
  screen: { flex: 1, backgroundColor: '#FEFEFE', alignItems: 'center', justifyContent: 'center' },
});
