#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <signal.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>

@interface DouStyleDelegate : NSObject <NSApplicationDelegate, SPUUpdaterDelegate>
@property SPUStandardUpdaterController *updates;
@property NSTask *themeTask;
@property NSPipe *commands;
@property NSPipe *states;
@property NSMutableData *buffer;
@property BOOL updateEnabled;
@property BOOL installing;
@property NSString *statusMessage;
@property dispatch_source_t terminationSignal;
@end

@implementation DouStyleDelegate
- (void)sendState {
  if (!self.themeTask.running) return;
  NSDictionary *state = @{ @"type": @"update-state", @"enabled": @(self.updateEnabled),
    @"busy": @((BOOL)!self.updates.updater.canCheckForUpdates), @"message": self.statusMessage ?: @"" };
  NSMutableData *data = [[NSJSONSerialization dataWithJSONObject:state options:0 error:nil] mutableCopy];
  [data appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
  @try { [self.states.fileHandleForWriting writeData:data]; } @catch (NSException *exception) { }
}
- (void)checkForUpdates:(id)sender {
  if (!self.updateEnabled || !self.updates.updater.canCheckForUpdates) { [self sendState]; return; }
  self.statusMessage = @"正在检查新版本";
  [NSApp activateIgnoringOtherApps:YES];
  [self.updates checkForUpdates:nil];
  [self sendState];
}
- (void)receiveCommands:(NSData *)data {
  [self.buffer appendData:data];
  if (self.buffer.length > 4096) { [self.buffer setLength:0]; return; }
  NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
  while (YES) {
    NSRange range = [self.buffer rangeOfData:newline options:0 range:NSMakeRange(0, self.buffer.length)];
    if (range.location == NSNotFound) break;
    NSString *command = [[NSString alloc] initWithData:[self.buffer subdataWithRange:NSMakeRange(0, range.location)] encoding:NSUTF8StringEncoding];
    [self.buffer replaceBytesInRange:NSMakeRange(0, range.location + 1) withBytes:NULL length:0];
    if ([command isEqualToString:@"check"]) [self checkForUpdates:nil];
    else if ([command isEqualToString:@"ready"]) [self sendState];
  }
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  signal(SIGPIPE, SIG_IGN);
  signal(SIGTERM, SIG_IGN);
  self.terminationSignal = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
  dispatch_source_set_event_handler(self.terminationSignal, ^{ [NSApp terminate:nil]; });
  dispatch_resume(self.terminationSignal);
  self.buffer = [NSMutableData data];
  NSBundle *bundle = NSBundle.mainBundle;
  self.updates = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:self userDriverDelegate:nil];
  [self.updates.updater addObserver:self forKeyPath:@"canCheckForUpdates" options:NSKeyValueObservingOptionNew context:NULL];
  NSError *error = nil;
  BOOL preview = [[bundle objectForInfoDictionaryKey:@"DouStylePreview"] boolValue];
  self.updateEnabled = !preview && [self.updates.updater startUpdater:&error];
  if (!self.updateEnabled) self.statusMessage = preview ? @"本地预览版" : @"更新服务配置不完整，请重新安装豆Style";
  NSMenu *menu = [[NSMenu alloc] init];
  NSMenuItem *appItem = [[NSMenuItem alloc] init];
  [menu addItem:appItem];
  NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"豆Style"];
  NSMenuItem *check = [appMenu addItemWithTitle:@"检查更新…" action:@selector(checkForUpdates:) keyEquivalent:@""];
  check.target = self;
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"退出豆Style" action:@selector(terminate:) keyEquivalent:@"q"];
  appItem.submenu = appMenu;
  NSApp.mainMenu = menu;
  self.commands = [NSPipe pipe];
  self.states = [NSPipe pipe];
  self.themeTask = [[NSTask alloc] init];
  self.themeTask.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
  self.themeTask.arguments = @[[bundle.resourcePath stringByAppendingPathComponent:@"launch.sh"]];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"DOUBAO_UPDATE_ENABLED"] = self.updateEnabled ? @"1" : @"0";
  environment[@"DOUBAO_APP_VERSION"] = [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"";
  self.themeTask.environment = environment;
  self.themeTask.standardOutput = self.commands;
  self.themeTask.standardInput = self.states;
  __weak DouStyleDelegate *weakSelf = self;
  self.commands.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (data.length == 0) { handle.readabilityHandler = nil; return; }
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf receiveCommands:data]; });
  };
  self.themeTask.terminationHandler = ^(NSTask *task) {
    dispatch_async(dispatch_get_main_queue(), ^{
      DouStyleDelegate *owner = weakSelf;
      if (owner && !owner.installing && !owner.updates.updater.sessionInProgress) [NSApp terminate:nil];
    });
  };
  if (![self.themeTask launchAndReturnError:&error]) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"豆Style 无法启动";
    alert.informativeText = @"启动组件未能运行，请重新安装豆Style。";
    [alert runModal];
    [NSApp terminate:nil];
  }
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
  for (NSString *bundleID in @[@"com.work.pc.doubao", @"com.bot.pc.doubao"]) {
    for (NSRunningApplication *application in [NSRunningApplication runningApplicationsWithBundleIdentifier:bundleID]) {
      [application activateWithOptions:NSApplicationActivateIgnoringOtherApps];
      return NO;
    }
  }
  NSString *scheme = [workspace URLForApplicationWithBundleIdentifier:@"com.work.pc.doubao"] ? @"doubaowork://" : @"doubao://";
  [workspace openURL:[NSURL URLWithString:scheme]];
  return NO;
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if ([keyPath isEqualToString:@"canCheckForUpdates"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [self sendState]; });
  } else {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  }
}
- (void)dealloc {
  [self.updates.updater removeObserver:self forKeyPath:@"canCheckForUpdates"];
}
- (void)applicationWillTerminate:(NSNotification *)notification {
  self.commands.fileHandleForReading.readabilityHandler = nil;
  if (self.themeTask.running) [self.themeTask terminate];
}
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
  self.statusMessage = [NSString stringWithFormat:@"发现新版本 %@，请在更新窗口中继续", item.displayVersionString];
  [self sendState];
}
- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error {
  self.statusMessage = @"当前没有可安装的新版本";
}
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {
  // Detailed failures are shown by Sparkle for a manual check; don't report latest on network errors.
  if (error.code != SUNoUpdateError) self.statusMessage = @"未能完成更新，请在更新窗口查看原因或稍后重试";
}
- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item {
  self.installing = YES;
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  self.installing = NO;
  // sessionInProgress resets after this delegate callback.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendState];
    if (!self.themeTask.running) [NSApp terminate:nil];
  });
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    // Finder, Sparkle and a direct launch can race; exactly one host owns the injector.
    NSString *directory = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/DouStyle"];
    [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *lockPath = [directory stringByAppendingPathComponent:[NSBundle.mainBundle.bundleIdentifier stringByAppendingString:@".lock"]];
    int lockFD = open(lockPath.fileSystemRepresentation, O_CREAT | O_RDWR | O_CLOEXEC, 0600);
    if (lockFD < 0 || flock(lockFD, LOCK_EX | LOCK_NB) != 0) {
      for (NSRunningApplication *other in [NSRunningApplication runningApplicationsWithBundleIdentifier:NSBundle.mainBundle.bundleIdentifier]) {
        if (other.processIdentifier != getpid()) [other activateWithOptions:NSApplicationActivateIgnoringOtherApps];
      }
      return 0;
    }
    NSApplication *app = NSApplication.sharedApplication;
    DouStyleDelegate *delegate = [[DouStyleDelegate alloc] init];
    app.delegate = delegate;
    [app run];
    close(lockFD);
  }
  return 0;
}
