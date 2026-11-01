Pod::Spec.new do |s|
  s.name = 'ArbmusicScanner'
  s.version = '1.0.0'
  s.summary = 'ArbMusic native music scanner plugin'
  s.license = 'MIT'
  s.homepage = 'https://arbmusic.local'
  s.authors = { 'ArbMusic' => 'dev@arbmusic.local' }
  s.source = { :path => '.' }
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.0'
  s.source_files = 'ios/Plugin/**/*.swift'
end
