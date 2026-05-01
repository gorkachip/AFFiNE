import { Module } from '@nestjs/common';

import { DocStorageModule } from '../doc';
import { AdminInjectDocController } from './controller';

@Module({
  imports: [DocStorageModule],
  controllers: [AdminInjectDocController],
})
export class AdminInjectModule {}
