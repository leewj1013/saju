// 로그인 화면: 위에 로고, 아래에 비회원 로그인 · Google 로그인
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { C, ErrorText } from '../components/ui';
import { clearLast, startGoogleLogin } from '../lib/saju';

const LOGO = require('../../assets/images/logo.jpg');
const GOOGLE_G = require('../../assets/images/google-g.png');

export default function LoginScreen() {
  const { login } = useLocalSearchParams<{ login?: string }>();
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(width * 0.72, height * 0.46, 380);
  const googleReady = Platform.OS === 'web'; // 앱 스토어 빌드용 로그인은 아직 없음

  return (
    <View style={st.screen}>
      <View style={st.top}>
        <Image source={LOGO} style={{ width: logoSize, height: logoSize }} resizeMode="contain" accessibilityLabel="사주 四柱" />
      </View>

      <View style={st.bottom}>
        {login === 'failed' && <ErrorText>Google 로그인에 실패했습니다. 다시 시도하거나 비회원으로 시작해 주세요.</ErrorText>}

        <Pressable
          onPress={async () => { await clearLast(); router.replace('/input'); }}
          accessibilityRole="button" accessibilityLabel="비회원 로그인"
          style={({ pressed }) => [st.button, st.guest, pressed && st.pressed]}
        >
          <Text style={st.guestText}>비회원 로그인</Text>
        </Pressable>

        <Pressable
          onPress={() => startGoogleLogin('/input')}
          disabled={!googleReady}
          accessibilityRole="button" accessibilityLabel="Google 계정으로 로그인" accessibilityState={{ disabled: !googleReady }}
          style={({ pressed }) => [st.button, st.google, pressed && st.pressed, !googleReady && st.disabled]}
        >
          <Image source={GOOGLE_G} style={st.googleIcon} accessibilityIgnoresInvertColors />
          <Text style={st.googleText}>Google 계정으로 로그인</Text>
        </Pressable>

        <Text style={st.note}>
          {googleReady
            ? '비회원으로 본 결과는 이 기기에만 남고, 로그인하면 보관함에 저장할 수 있어요.'
            : '앱에서의 Google 로그인은 준비 중입니다.'}
        </Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground, paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center' },  bottom: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12 },
  button: { minHeight: 52, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  guest: { backgroundColor: C.ink },
  guestText: { fontSize: 16, fontWeight: '600', color: C.surface },
  // Google 브랜드 가이드의 흰색 버튼: 흰 바탕 · 회색 테두리 · 진한 글자
  google: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#747775' },
  googleIcon: { width: 22, height: 22 },
  googleText: { fontSize: 16, fontWeight: '600', color: '#1F1F1F' },
  note: { fontSize: 13, lineHeight: 19, color: C.ink2, textAlign: 'center', marginTop: 4 },
});
