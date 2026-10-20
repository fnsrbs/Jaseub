export function CheckoutGuide({ endTime }: { endTime?: string } = {}) {
  return (
    <p className="checkout-guide">
      {endTime
        ? `오늘은 운영일 설정에 따라 ${endTime.slice(0, 5)}에 자동으로 퇴실 처리됩니다.`
        : "월·화 오후 4시 30분, 수·목·금 오후 3시 30분에 자동으로 퇴실 처리됩니다. 운영일을 따로 설정한 날은 해당 종료 시각을 따릅니다."}
      퇴실 QR은 조퇴 등 해당 시각보다 일찍 나갈 때만 찍어 주세요.
    </p>
  );
}
export function CameraGuide() {
  return (
    <p className="camera-guide">
      QR이 안 되면 새로고침한 뒤 ‘카메라 시작 / 재시도’를 누르고 카메라 권한을
      ‘허용’해 주세요. 이미 차단했다면 브라우저의 사이트 설정에서 카메라를
      허용해 주세요.
    </p>
  );
}
