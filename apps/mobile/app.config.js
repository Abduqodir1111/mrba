const { validateReleaseApiUrl } = require("./release-config.cjs");
module.exports = ({ config }) => {
  const release = process.env.MRBA_RELEASE === "1";
  if (release) validateReleaseApiUrl(process.env.EXPO_PUBLIC_API_URL);
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      "@react-native-community/datetimepicker",
      // iOS 27 terminates apps using the legacy application lifecycle at launch.
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
    ],
    ios: {
      ...config.ios,
      buildNumber: config.ios?.buildNumber ?? "1",
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: release
          ? { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false }
          : { NSAllowsLocalNetworking: true },
      },
    },
  };
};
