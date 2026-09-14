// SCR-SHARE-02 공유 링크 열람 (PRD §3.2): 로그인 없이, 결과 화면과 같은 모양으로 보여 주고 내 사주 보기로 유도
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, C } from '../../components/ui';
import { ReadingError, openShare, track } from '../../lib/saju';
import type { Shared } from '../../lib/saju';
import { ResultBody } from '../result';

export default function SharedScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [shared, setShared] = useState<Shared>();
  const [failed, setFailed] = useState<'NOT_FOUND' | 'OTHER'>();

  useEffect(() => {
    openShare(token)
      .then(s => {
        setShared(s);
        track('result_view', { source: 'share' });
      })
      .catch(e => setFailed(e instanceof ReadingError && e.errors[0]?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'OTHER'));
  }, [token]);

  if (failed) {
    return (
      <View style={st.empty}>
        <Text style={st.h2}>{failed === 'NOT_FOUND' ? '열 수 없는 링크입니다' : '결과를 불러오지 못했습니다'}</Text>
        <Text style={st.body}>
          {failed === 'NOT_FOUND'
            ? '공유한 지 30일이 지났거나, 공유한 사람이 사주를 삭제했을 수 있어요.'
            : '인터넷 연결을 확인하고 다시 열어 주세요.'}
        </Text>
        <Button label="내 사주 보기" onPress={() => router.replace('/')} />
      </View>
    );
  }
  if (!shared) return <View style={st.screen} />;
  return <ResultBody saved={shared} shared />;
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  empty: { flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center' },
  body: { fontSize: 15, color: C.ink2, lineHeight: 23, textAlign: 'center', maxWidth: 360 },
});
