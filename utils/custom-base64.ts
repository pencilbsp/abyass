export class CustomBase64 {
  private static alphabetic =
    "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";
  static encode(input: string, alphabetic = CustomBase64.alphabetic): string {
    const encodedString = unescape(encodeURIComponent(input));

    let encryptedString = "";

    // Mã hóa từng bộ ba ký tự
    for (let i = 0; i < encodedString.length; i += 3) {
      const firstCharCode = encodedString.charCodeAt(i);
      const secondCharCode =
        i + 1 < encodedString.length ? encodedString.charCodeAt(i + 1) : 0x40;
      const thirdCharCode =
        i + 2 < encodedString.length ? encodedString.charCodeAt(i + 2) : 0x40;

      // Tính toán các giá trị mã hóa
      const firstOutput = (firstCharCode >> 2) & 0x3f;
      const secondOutput =
        ((firstCharCode & 0x3) << 4) | ((secondCharCode >> 4) & 0xf);
      const thirdOutput =
        secondCharCode !== 0x40
          ? ((secondCharCode & 0xf) << 2) | ((thirdCharCode >> 6) & 0x3)
          : 0x40;
      const fourthOutput = thirdCharCode !== 0x40 ? thirdCharCode & 0x3f : 0x40;

      // Ánh xạ các giá trị sang ký tự trong encryptionKey
      encryptedString += alphabetic[firstOutput];
      encryptedString += alphabetic[secondOutput];
      if (thirdOutput !== 0x40) encryptedString += alphabetic[thirdOutput];
      if (fourthOutput !== 0x40) encryptedString += alphabetic[fourthOutput];
    }

    // Thêm padding bằng '=' nếu cần để đảm bảo độ dài chuỗi là bội số của 4
    while (encryptedString.length % 4 !== 0) {
      encryptedString += "=";
    }

    return encryptedString;
  }
  static decode(input: string, alphabetic = CustomBase64.alphabetic): string {
    let sanitizedInput = input.replace(/[^A-Za-z0-9+/=]/g, "");
    let decodedString = "";
    let index = 0;

    while (index < sanitizedInput.length) {
      const firstCharValue =
        (alphabetic.indexOf(sanitizedInput[index++] ?? "") << 2) |
        (alphabetic.indexOf(sanitizedInput[index] ?? "") >> 4);
      const secondCharValue = alphabetic.indexOf(sanitizedInput[index++] ?? "");
      const thirdCharValue =
        ((0xf & secondCharValue) << 4) |
        (alphabetic.indexOf(sanitizedInput[index] ?? "") >> 2);
      const fourthCharCode = alphabetic.indexOf(sanitizedInput[index++] ?? "");
      const fifthCharCode =
        ((0x3 & fourthCharCode) << 6) |
        alphabetic.indexOf(sanitizedInput[index++] ?? "");

      decodedString += String.fromCharCode(firstCharValue);
      if (fourthCharCode !== 0x40)
        decodedString += String.fromCharCode(thirdCharValue);
      if (fifthCharCode !== 0x40)
        decodedString += String.fromCharCode(fifthCharCode);
    }

    return decodeURIComponent(escape(decodedString));
  }
}
