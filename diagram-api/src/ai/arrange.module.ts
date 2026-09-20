import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ArrangeDto } from './arrange.dto.js';
import { ArrangeProvider, ArrangeService } from './arrange.service.js';

@Controller('ai')
@UseGuards(JwtAuthGuard)
class ArrangeController {
  constructor(private readonly service: ArrangeService) {}

  @Post('arrange')
  arrange(@Body() input: ArrangeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.arrange(input, user.id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [ArrangeController],
  providers: [ArrangeProvider, ArrangeService],
})
export class ArrangeModule {}
