import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { Public } from '../auth';
import { DocWriter } from '../doc';

interface InjectDocBody {
  workspaceId: string;
  // Either docId (overwrite that doc) OR title (create a new doc with that title)
  docId?: string;
  title?: string;
  markdown: string;
  editorId?: string;
}

/**
 * MOJO: one-off admin endpoint to write a doc directly from a script. Lets us
 * push branded SOP markdown into AFFiNE without involving a browser. Gated by
 * MOJO_ADMIN_INJECT_SECRET env var so only the holder can call it.
 */
@Controller('/api/admin/inject-doc')
export class AdminInjectDocController {
  private readonly logger = new Logger(AdminInjectDocController.name);

  constructor(
    private readonly writer: DocWriter,
    private readonly prisma: PrismaClient
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async injectDoc(
    @Headers('x-mojo-admin-secret') secret: string | undefined,
    @Body() body: InjectDocBody
  ) {
    const expected = process.env.MOJO_ADMIN_INJECT_SECRET;
    if (!expected) {
      throw new ForbiddenException(
        'MOJO_ADMIN_INJECT_SECRET not set on the server'
      );
    }
    if (!secret || secret !== expected) {
      throw new ForbiddenException('Invalid or missing X-Mojo-Admin-Secret');
    }

    if (!body.workspaceId || !body.markdown) {
      throw new ForbiddenException('workspaceId and markdown are required');
    }

    if (body.docId) {
      // Update existing doc — uses delta diff so existing content gets cleanly
      // replaced (or appended-to-zero for an empty doc).
      try {
        await this.writer.updateDoc(
          body.workspaceId,
          body.docId,
          body.markdown,
          body.editorId
        );
      } catch (err) {
        if (err instanceof NotFoundException) {
          throw err;
        }
        this.logger.error(`updateDoc failed for ${body.docId}`, err as Error);
        throw err;
      }
      return {
        ok: true,
        mode: 'update',
        workspaceId: body.workspaceId,
        docId: body.docId,
      };
    }

    if (!body.title) {
      throw new ForbiddenException(
        'either docId (to update) or title (to create) is required'
      );
    }
    const created = await this.writer.createDoc(
      body.workspaceId,
      body.title,
      body.markdown,
      body.editorId
    );
    return {
      ok: true,
      mode: 'create',
      workspaceId: body.workspaceId,
      docId: created.docId,
    };
  }

  /**
   * Helper: lookup a doc id by its title within a workspace. Useful when the
   * caller only knows the doc by name. Returns the first match.
   */
  @Public()
  @Post('/find')
  @HttpCode(200)
  async findDoc(
    @Headers('x-mojo-admin-secret') secret: string | undefined,
    @Body() body: { workspaceId: string; title: string }
  ) {
    const expected = process.env.MOJO_ADMIN_INJECT_SECRET;
    if (!expected || !secret || secret !== expected) {
      throw new ForbiddenException('Invalid or missing X-Mojo-Admin-Secret');
    }

    const docs = await this.prisma.workspaceDoc.findMany({
      where: {
        workspaceId: body.workspaceId,
        title: body.title,
      },
      take: 5,
    });
    return {
      matches: docs.map(d => ({
        docId: d.docId,
        title: d.title,
        mode: d.mode,
      })),
    };
  }
}
