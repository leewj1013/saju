import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { C } from '../components/ui';
import { clearLast, fetchMe, inAppBrowser, logout, openInExternalBrowser, startGoogleLogin } from '../lib/saju';
import type { Me } from '../lib/saju';

// 웹: 스크린 리더가 한국어로 읽도록. 단일 페이지 출력은 +html.tsx가 적용되지 않아(export 결과 lang="en") 여기서 지정
if (Platform.OS === 'web') document.documentElement.lang = 'ko';

// 카카오톡 등 앱 안 브라우저는 로그인 쿠키 · 저장된 결과가 기본 브라우저와 따로라, 링크를 다시 열 때마다 로그아웃돼 보인다.
// 들어오자마자 같은 주소를 기본 브라우저로 넘긴다 (넘길 수 없는 iOS의 카카오톡 외 앱은 그대로 두고, 로그인 때 안내)
if (Platform.OS === 'web' && inAppBrowser()) openInExternalBrowser(window.location.href);

/** 헤더 오른쪽: 로그인 전 "Google로 로그인", 로그인 후 "보관함 · 로그아웃" (웹만) */
function Account() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    fetchMe().then(setMe);
  }, []);

  if (Platform.OS !== 'web' || me === undefined) return null;
  const matchButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="궁합 보기" hitSlop={8} style={s.button} onPress={() => router.push('/match')}>
      <Text style={s.text}>궁합</Text>
    </Pressable>
  );
  if (!me) {
    return (
      <View style={s.row}>
        {matchButton}
        <Pressable
          accessibilityRole="button" accessibilityLabel="Google로 로그인" hitSlop={8} style={s.button}
          onPress={() => startGoogleLogin(window.location.pathname + window.location.search)}
        >
          <Text style={s.text}>Google로 로그인</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={s.row}>
      {matchButton}
      <Pressable accessibilityRole="button" accessibilityLabel="사주 보관함" hitSlop={8} style={s.button} onPress={() => router.push('/archive')}>
        <Text style={s.text}>보관함</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button" accessibilityLabel="로그아웃" hitSlop={8} style={s.button}
        onPress={async () => { await logout(); await clearLast(); setMe(null); router.replace('/login'); }}
      >
        <Text style={[s.text, s.muted]}>로그아웃</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.surface },
          headerTintColor: C.ink,
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.ground },
          headerRight: () => <Account />,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: '사주', animation: 'fade' }} />
        <Stack.Screen name="login" options={{ headerShown: false, title: '로그인', animation: 'fade' }} />
        <Stack.Screen name="input" options={{ title: '사주 정보 입력' }} />
        <Stack.Screen name="result" options={{ title: '사주 결과' }} />
        <Stack.Screen name="archive" options={{ title: '사주 보관함' }} />
        <Stack.Screen name="s/[token]" options={{ title: '공유된 사주' }} />
        <Stack.Screen name="match" options={{ title: '궁합 보기' }} />
        <Stack.Screen name="match-result" options={{ title: '궁합 결과' }} />
      </Stack>
    </>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: { minHeight: 44, paddingHorizontal: 9, justifyContent: 'center' }, // 모바일 헤더에 버튼 3개가 들어가도록
  text: { fontSize: 14, fontWeight: '600', color: C.ink },
  muted: { color: C.ink2, fontWeight: '500' },
});
